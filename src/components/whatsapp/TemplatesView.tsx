"use client";

// Templates tab of the WhatsApp dashboard. Thin shell: the list lives in
// ./templates/TemplateList (grouped For campaigns / Automatic messages /
// Team alerts) and the guided 4-step creator in ./templates/creator. Every
// Meta rule is checked live (template-rules.ts) and every Meta rejection or
// error is explained in plain English (template-errors.ts).

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { nextVersionName } from "@/lib/whatsapp/template-rules";
import { draftFromRow, type EditorDraft } from "@/lib/whatsapp/template-draft";
import { friendlyTemplateName, templateKind } from "@/lib/whatsapp/templateKind";
import {
  automaticEditWarning, automaticUse, type AutomaticWarning, type CustomFlowLike, type FlowSettingsLike,
} from "@/lib/whatsapp/template-access";
import { useAccess } from "@/components/shell/useAccess";
import { attachHeaderFile, syncFromMeta, useTemplates, type TemplateRow } from "./templates/api";
import { ProblemBox } from "./templates/bits";
import { DeleteTemplateDialog } from "./templates/DeleteTemplateDialog";
import { TemplateList } from "./templates/TemplateList";
import { TemplateCreator } from "./templates/creator/TemplateCreator";
import { WaHeader, WaMoreMenu } from "./WaHeader";
import s from "./templates/templates.module.css";

type Editing = { initial: EditorDraft | null; key: number; automatic?: AutomaticWarning | null };

// Which automations use which template (order confirmation slots + custom
// flows), so editing an automatic message can warn truthfully. Admin only:
// only admins can edit those templates.
async function fetchFlowUsage(): Promise<{ settings: FlowSettingsLike; custom: CustomFlowLike[] }> {
  const r = await fetch("/api/whatsapp/flows");
  if (!r.ok) throw new Error(`Could not load automations (${r.status}).`);
  const j = (await r.json()) as { settings?: FlowSettingsLike; custom?: CustomFlowLike[] };
  return { settings: j.settings ?? null, custom: j.custom ?? [] };
}

export default function TemplatesView() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { q, list, refresh } = useTemplates();
  const access = useAccess();
  const isAdmin = access?.admin === true;
  const usageQ = useQuery({ queryKey: ["wa-template-usage"], queryFn: fetchFlowUsage, enabled: isAdmin, staleTime: 60_000 });
  const openCount = useRef(0);
  // ?new=1 (from the campaign wizard's "Create a new template") opens the
  // creator straight away; the effect below drops the flag from the URL.
  const [editing, setEditing] = useState<Editing | null>(() =>
    searchParams.get("new") === "1" ? { initial: null, key: 0 } : null,
  );
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  const takenNames = useMemo(() => new Set(list.map((t) => t.name)), [list]);
  const approved = useMemo(() => list.filter((t) => String(t.status ?? "").toLowerCase() === "approved").length, [list]);

  const open = (initial: EditorDraft | null, automatic: AutomaticWarning | null = null) =>
    setEditing({ initial, key: ++openCount.current, automatic });

  // Automatic (utility) templates get a warning in the creator; marketing and
  // never-submitted drafts don't need one.
  function warningFor(t: TemplateRow, mode: "edit" | "copy", draftMode: EditorDraft["mode"]): AutomaticWarning | null {
    if (templateKind(t) !== "customer_service") return null;
    if (mode === "edit" && draftMode !== "edit") return null;
    const use = automaticUse(t.name, usageQ.data?.settings, usageQ.data?.custom);
    return automaticEditWarning(t.name, use, mode, usageQ.isSuccess);
  }

  // Drop ?new=1 so a reload doesn't reopen the creator. If the link is
  // followed again while this tab is mounted, open it then.
  const newFlag = searchParams.get("new") === "1";
  useEffect(() => {
    if (!newFlag) return;
    router.replace("/dashboard/whatsapp?tab=templates");
  }, [newFlag, router]);
  const [seenFlag, setSeenFlag] = useState(newFlag);
  if (newFlag !== seenFlag) {
    setSeenFlag(newFlag);
    if (newFlag && !editing) setEditing({ initial: null, key: -1 });
  }

  async function onSync() {
    setSyncing(true);
    const r = await syncFromMeta();
    setSyncing(false);
    if (!r.ok) {
      toast.push({ kind: "error", text: `Could not refresh from Meta. ${r.problem.title}. ${r.problem.howToFix}` });
      return;
    }
    const synced = (r.data.synced as { status: string }[]) ?? [];
    toast.push({ kind: "success", text: `Refreshed ${synced.length} template(s) from Meta. ${synced.filter((x) => x.status === "approved").length} approved.` });
    refresh();
  }

  async function onAttachMedia(t: TemplateRow, url: string | null) {
    if (!url) return;
    const r = await attachHeaderFile(t.id, url);
    if (!r.ok) { toast.push({ kind: "error", text: `${r.problem.title}. ${r.problem.howToFix}` }); return; }
    toast.push({ kind: "success", text: `"${friendlyTemplateName(t.name)}" can now be used in campaigns.` });
    refresh();
  }

  return (
    <div className={s.view}>
      <WaHeader
        title="Templates"
        summary={
          <>
            Messages Meta has approved. Campaigns and automations can only use these.
            {approved > 0 && <> <b>{approved} approved</b>.</>}
          </>
        }
        actions={
          <>
            <WaMoreMenu>
              <button type="button" role="menuitem" onClick={onSync} disabled={syncing}>
                <RefreshCw aria-hidden="true" /> {syncing ? "Refreshing..." : "Refresh from Meta"}
              </button>
            </WaMoreMenu>
            <button type="button" className="pm2-btn pri" onClick={() => open(null)}>
              <Plus aria-hidden="true" /> New template
            </button>
          </>
        }
      />

      {q.isError && (
        <ProblemBox problem={{
          title: "Could not load templates",
          explanation: q.error instanceof Error ? q.error.message : "Unknown error.",
          howToFix: "Refresh the page. If it keeps happening, tell the owner.", raw: null, known: false,
        }} />
      )}
      {q.isLoading && <div className="pm2-empty">Loading templates...</div>}

      {!q.isError && (
        <TemplateList
          list={list}
          loading={q.isLoading}
          onCreate={() => open(null)}
          isAdmin={isAdmin}
          onEdit={(t) => { const d = draftFromRow(t); open(d, warningFor(t, "edit", d.mode)); }}
          onDuplicate={(t) => { const d = draftFromRow(t, nextVersionName(t.name, takenNames)); open(d, warningFor(t, "copy", d.mode)); }}
          onDelete={(t) => setDeleting(t)}
          onAttachMedia={onAttachMedia}
        />
      )}

      {deleting && (
        <DeleteTemplateDialog
          t={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(t) => {
            toast.push({ kind: "success", text: `Deleted "${friendlyTemplateName(t.name)}".` });
            setDeleting(null);
            refresh();
          }}
        />
      )}

      {editing && (
        <TemplateCreator
          key={editing.key}
          initial={editing.initial}
          automatic={editing.automatic ?? null}
          takenNames={takenNames}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}
