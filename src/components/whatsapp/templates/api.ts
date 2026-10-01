"use client";

// Data layer for the Templates tab: React Query list (auto refresh while
// anything is waiting for Meta), approval toasts, one auto sync on open, and
// thin wrappers around /api/whatsapp/templates/** (save, submit incl.
// mode:'edit', sync, delete, attach missing header file).

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import { explainTemplateError, type MetaErrorShape, type TemplateProblem } from "@/lib/whatsapp/template-errors";
import type { Issue } from "@/lib/whatsapp/template-rules";
import { saveDraftBody, submitBody, type EditorDraft } from "@/lib/whatsapp/template-draft";
import type { Template } from "../types";

// Columns added by migration 20260929110000_wa_templates_v2.sql (optional so
// the page still works before it is applied).
export type TemplateRow = Template & {
  quality_score?: string | null;
  rejected_reason_detail?: string | null;
  previous_category?: string | null;
  header_samples?: string[] | null;
  needs_media?: boolean | null;
  last_synced_at?: string | null;
};

export const TEMPLATES_KEY = ["wa-templates"] as const;

export async function readJson(r: Response): Promise<Record<string, unknown>> {
  try {
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: `The server answered ${r.status}.` };
  }
}

async function fetchTemplates(): Promise<TemplateRow[]> {
  const r = await fetch("/api/whatsapp/templates");
  const j = await readJson(r);
  if (!r.ok || j.error) throw new Error(String(j.error ?? `Could not load templates (${r.status}).`));
  return (j.templates as TemplateRow[]) ?? [];
}

const OFFLINE = "Could not reach the server. Check your internet connection and try again.";

/** Template list + approval toasts + one sync on open when something is waiting for Meta. */
export function useTemplates() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: fetchTemplates,
    // While anything is in Meta review, re-read every minute so approvals
    // picked up by the wa-template-sync cron land on screen by themselves.
    refetchInterval: (query) => ((query.state.data ?? []).some((t) => t.status === "pending") ? 60_000 : false),
  });
  const list = useMemo(() => q.data ?? [], [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY });

  // Toast when a template leaves review.
  const prevStatus = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!q.data) return;
    const prev = prevStatus.current;
    if (prev) {
      for (const t of q.data) {
        if (prev.get(`${t.name}:${t.language}`) !== "pending") continue;
        const name = friendlyTemplateName(t.name);
        if (t.status === "approved") toast.push({ kind: "success", text: `"${name}" was approved by Meta. You can use it in campaigns now.` });
        else if (t.status === "rejected") toast.push({ kind: "error", text: `"${name}" needs changes. Open it to see why and fix it.` });
      }
    }
    prevStatus.current = new Map(q.data.map((t) => [`${t.name}:${t.language}`, t.status]));
  }, [q.data, toast]);

  // On open: if anything is still in Meta review, sync once right away.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (autoSynced.current || !q.data) return;
    autoSynced.current = true;
    if (!q.data.some((t) => t.status === "pending")) return;
    (async () => {
      try {
        const r = await fetch("/api/whatsapp/templates/sync", { method: "POST" });
        const j = await readJson(r);
        if (r.ok && j.ok !== false) qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
      } catch { /* silent: the manual button reports errors */ }
    })();
  }, [q.data, qc]);

  return { q, list, refresh };
}

export type ApiResult = { ok: true; data: Record<string, unknown> } | { ok: false; problem: TemplateProblem; issues?: Issue[] };

export async function syncFromMeta(): Promise<ApiResult> {
  try {
    const r = await fetch("/api/whatsapp/templates/sync", { method: "POST" });
    const j = await readJson(r);
    if (!r.ok || j.ok === false) return { ok: false, problem: explainTemplateError(String(j.error ?? `Error ${r.status}`)) };
    return { ok: true, data: j };
  } catch {
    return { ok: false, problem: explainTemplateError(OFFLINE) };
  }
}

export async function deleteTemplate(id: string): Promise<ApiResult> {
  try {
    const r = await fetch(`/api/whatsapp/templates/${id}`, { method: "DELETE" });
    const j = await readJson(r);
    if (!r.ok || j.ok === false) {
      return { ok: false, problem: explainTemplateError((j.meta_error as MetaErrorShape) ?? String(j.error ?? `Error ${r.status}`)) };
    }
    return { ok: true, data: j };
  } catch {
    return { ok: false, problem: explainTemplateError(OFFLINE) };
  }
}

/** Store the header file for a template that already exists at Meta. Does not resubmit it. */
export async function attachHeaderFile(id: string, url: string): Promise<ApiResult> {
  try {
    const r = await fetch(`/api/whatsapp/templates/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ header_media_url: url, needs_media: false }),
    });
    const j = await readJson(r);
    if (!r.ok || j.error) return { ok: false, problem: explainTemplateError(String(j.error ?? "Could not save the file.")) };
    return { ok: true, data: j };
  } catch {
    return { ok: false, problem: explainTemplateError(OFFLINE) };
  }
}

/** Save as a draft in the CRM (never sent to Meta). */
export async function saveDraft(d: EditorDraft): Promise<ApiResult> {
  try {
    const r = await fetch("/api/whatsapp/templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saveDraftBody(d)),
    });
    const j = await readJson(r);
    if (!r.ok || j.error) return { ok: false, problem: explainTemplateError(String(j.error ?? "Could not save the draft.")) };
    return { ok: true, data: j };
  } catch {
    return { ok: false, problem: explainTemplateError(OFFLINE) };
  }
}

type SubmitJson = { ok?: boolean; error?: string; issues?: Issue[]; meta_error?: unknown; results?: { error?: string; meta_error?: unknown }[] };

/** Send to Meta for approval (create, or edit when it already exists at Meta). */
export async function submitToMeta(d: EditorDraft): Promise<ApiResult> {
  try {
    const r = await fetch("/api/whatsapp/templates/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitBody(d)),
    });
    const j = (await readJson(r)) as SubmitJson;
    if (!r.ok || j.ok === false || j.error) {
      if (Array.isArray(j.issues) && j.issues.length) {
        return {
          ok: false,
          issues: j.issues,
          problem: {
            title: "Please fix the items marked in red",
            explanation: "We checked the template again on our server before sending it to Meta, and it found problems.",
            howToFix: "Fix each item in the checklist, then send it again.",
            raw: null, known: true,
          },
        };
      }
      const first = j.results?.[0];
      const meta = (j.meta_error ?? first?.meta_error) as MetaErrorShape | undefined;
      return { ok: false, problem: explainTemplateError(meta ?? j.error ?? first?.error ?? `Error ${r.status}`) };
    }
    return { ok: true, data: j as Record<string, unknown> };
  } catch {
    return { ok: false, problem: explainTemplateError(OFFLINE) };
  }
}
