"use client";

// Orders & COD → Call rules (cod-voice.html #or-settings). The same COD
// confirmation and cart-call settings as WhatsApp → Automations → Order
// messages: it renders the very same cards (flows/OrderSection CodCard and
// VoiceCard) and saves exactly like AutomationsView does: one PATCH
// /api/whatsapp/flows with the changed keys, and a ConfirmDialog before any
// on/off switch. Owner/Admin only to change (the API enforces it too).

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { useAccess } from "@/components/shell/useAccess";
import { apiFetch } from "@/lib/api-fetch";
import type { Template } from "@/components/whatsapp/types";
import type { FlowsCtx } from "@/components/whatsapp/flows/context";
import { TOGGLE_COPY } from "@/components/whatsapp/flows/copy";
import { LockNote } from "@/components/whatsapp/flows/bits";
import { CodCard, VoiceCard } from "@/components/whatsapp/flows/OrderSection";
import type { BoolKey, FlowSettings, FlowsPayload, SettingKey, VoiceStats } from "@/components/whatsapp/flows/types";
import fs from "@/components/whatsapp/flows/flows.module.css";

type Pending = { title: string; body: string; confirmLabel: string; danger?: boolean; run: () => Promise<void> };

const NO_VOICE: VoiceStats = { placed: 0, connected: 0, linkSent: 0, recovered: 0, assistedRecovered: 0 };

export function CallRules() {
  const toast = useToast();
  const access = useAccess();
  const isAdmin = access?.admin === true;

  // Same query keys as AutomationsView, so both screens share one cache.
  const flowsQ = useQuery({
    queryKey: ["wa-flows"],
    queryFn: () => apiFetch<FlowsPayload>("/api/whatsapp/flows"),
  });
  const tplQ = useQuery({
    queryKey: ["wa-templates-all"],
    queryFn: () => apiFetch<{ templates?: Template[] }>("/api/whatsapp/templates").then((r) => r.templates ?? []),
    staleTime: 60_000,
  });
  const voiceQ = useQuery({
    queryKey: ["cart-recovery"],
    queryFn: () => apiFetch<{ stats?: { voice?: VoiceStats } }>("/api/whatsapp/cart-recovery").then((r) => r.stats),
  });

  const [saved, setSaved] = useState<FlowSettings | null>(null);
  const [draft, setDraft] = useState<FlowSettings | null>(null);
  const [seen, setSeen] = useState<FlowsPayload | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  // Adopt fresh server data (first load, refetch) without clobbering edits.
  if (flowsQ.data && flowsQ.data !== seen) {
    setSeen(flowsQ.data);
    const st = flowsQ.data.settings;
    if (st) {
      const hasEdits = !!(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
      setSaved(st);
      if (!hasEdits) setDraft(st);
    }
  }

  const dirtyKeys = useMemo(() => {
    if (!saved || !draft) return [] as SettingKey[];
    return (Object.keys(draft) as SettingKey[]).filter((k) => draft[k] !== saved[k]);
  }, [saved, draft]);

  const set = useCallback(<K extends SettingKey>(k: K, v: FlowSettings[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }, []);

  async function patchSettings(patch: Partial<FlowSettings>): Promise<FlowSettings | null> {
    try {
      const j = await apiFetch<{ settings: FlowSettings }>("/api/whatsapp/flows", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      return j.settings;
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Couldn't save." });
      return null;
    }
  }

  function requestToggle(k: BoolKey, next: boolean) {
    const copy = TOGGLE_COPY[k];
    const name = copy?.name ?? "this automation";
    setPending({
      title: next ? `Turn on ${name}?` : `Turn off ${name}?`,
      body: (next ? copy?.on : copy?.off) ?? "This changes what customers receive.",
      confirmLabel: next ? "Turn on" : "Turn off",
      danger: !next,
      run: async () => {
        const st = await patchSettings({ [k]: next } as Partial<FlowSettings>);
        if (!st) return;
        setSaved(st);
        setDraft((d) => (d ? { ...d, [k]: st[k] } : st));
        toast.push({ kind: "success", text: `${name} is now ${next ? "on" : "off"}.` });
      },
    });
  }

  async function saveDraft() {
    if (!draft || !saved || dirtyKeys.length === 0) return;
    const patch: Record<string, unknown> = {};
    for (const k of dirtyKeys) patch[k] = draft[k];
    setSaving(true);
    const st = await patchSettings(patch as Partial<FlowSettings>);
    setSaving(false);
    if (!st) return;
    setSaved(st);
    setDraft(st);
    toast.push({ kind: "success", text: "Saved. New timings apply to customers who start an automation from now on." });
  }

  if (!draft || !saved) {
    if (flowsQ.isError) {
      return (
        <div className={fs.center}>
          <span>Couldn&apos;t load call rules: {flowsQ.error instanceof Error ? flowsQ.error.message : "unknown error"}</span>
          <button type="button" className="pm2-btn sm" onClick={() => flowsQ.refetch()}>
            <RefreshCw aria-hidden="true" /> Try again
          </button>
        </div>
      );
    }
    return <div className="pm2-skel" style={{ minHeight: 320 }} />;
  }

  const ctx: FlowsCtx = {
    draft,
    saved,
    set,
    requestToggle,
    templates: tplQ.data ?? [],
    statusRows: flowsQ.data?.templates ?? [],
    stats: flowsQ.data?.stats ?? {},
    voice: voiceQ.data?.voice ?? NO_VOICE,
    isAdmin,
  };

  return (
    <div className={fs.wrap}>
      {!isAdmin && (
        <LockNote>Only the owner can change call rules because they affect every order. You can see how they work below.</LockNote>
      )}
      <CodCard c={ctx} />
      <VoiceCard c={ctx} />

      {dirtyKeys.length > 0 && (
        <div className={fs.saveBar} role="region" aria-label="Unsaved changes">
          <span className={fs.saveNote}>
            <AlertTriangle aria-hidden="true" />
            Unsaved changes to call rules.
          </span>
          <button type="button" className="pm2-btn" onClick={() => setDraft(saved)} disabled={saving}>
            Discard
          </button>
          <button type="button" className="pm2-btn pri" onClick={saveDraft} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          keepLabel="Cancel"
          danger={pending.danger}
          busy={busy}
          onClose={() => {
            if (!busy) setPending(null);
          }}
          onConfirm={async () => {
            setBusy(true);
            try {
              await pending.run();
            } finally {
              setBusy(false);
              setPending(null);
            }
          }}
        />
      )}
    </div>
  );
}

export default CallRules;
