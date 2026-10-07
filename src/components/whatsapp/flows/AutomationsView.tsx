"use client";

// Automations tab: every automatic WhatsApp message, in plain words.
//
// Settings live in wa_flow_settings (singleton) via /api/whatsapp/flows; the
// edge functions read the same row, so a saved change IS the live config.
// Timing changes apply to customers who ENTER a flow from then on; messages
// already scheduled keep their time. Turning a flow off holds pending sends
// without deleting them. Nothing here changes WHAT an automation sends.
//
// Two sections:
//   Marketing automations: cart, review, restock + teammate-made ones.
//     Anyone with the WhatsApp marketing area can edit them.
//   Order messages: confirmation, COD confirm, shipping, voice call, sign-off.
//     Owner/Admin only (the API enforces the same, see flows/permissions.ts).

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { useAccess } from "@/components/shell/useAccess";
import { apiFetch } from "@/lib/api-fetch";
import type { Template } from "../types";
import { AutomationDisplay } from "./AutomationCard";
import { LockNote } from "./bits";
import type { FlowsCtx } from "./context";
import { TOGGLE_COPY } from "./copy";
import { CustomFlowCard } from "./CustomFlowCard";
import { FlowBuilder } from "./FlowBuilder";
import { RecipeGallery } from "./RecipeGallery";
import { friendlyDuration, TRIGGER_TEXT, type Recipe } from "./logic";
import { CartCard, RestockCard, ReviewCard } from "./MarketingSection";
import { CodCard, ConfirmationCard, ShippingCard, SignOffCard, VoiceCard } from "./OrderSection";
import { ORDER_MESSAGE_KEYS } from "@/app/api/whatsapp/flows/permissions";
import type { BoolKey, CustomFlow, FlowSettings, FlowsPayload, SettingKey, VoiceStats } from "./types";
import s from "./flows.module.css";

type View = { kind: "list" } | { kind: "gallery" } | { kind: "builder"; flow: CustomFlow | null; recipe: Recipe | null };
type Pending = { title: string; body: string; confirmLabel: string; danger?: boolean; run: () => Promise<void> };

const NO_VOICE: VoiceStats = { placed: 0, connected: 0, linkSent: 0, recovered: 0, assistedRecovered: 0 };

export default function AutomationsView() {
  const toast = useToast();
  const access = useAccess();
  const isAdmin = access?.admin === true;

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
  const [custom, setCustom] = useState<CustomFlow[] | null>(null);
  const [seen, setSeen] = useState<FlowsPayload | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  // Which automation is open on its own page (list when null). UI only.
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Adopt fresh server data (first load, refetch) without clobbering edits.
  if (flowsQ.data && flowsQ.data !== seen) {
    setSeen(flowsQ.data);
    const st = flowsQ.data.settings;
    if (st) {
      const hasEdits = !!(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
      setSaved(st);
      if (!hasEdits) setDraft(st);
    }
    setCustom(flowsQ.data.custom ?? []);
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

  function toggleCustom(f: CustomFlow) {
    const next = !f.enabled;
    const n = f.steps.length;
    const firstWait = friendlyDuration(Number(f.steps[0]?.delay_hours ?? 0));
    const firstWhen = firstWait === "right away" ? "right away" : `after ${firstWait}`;
    setPending({
      title: next ? `Turn on "${f.name}"?` : `Turn off "${f.name}"?`,
      body: next
        ? `From now on, ${TRIGGER_TEXT[f.trigger_event].when.replace(/^When/, "when")}, they will get ${n} WhatsApp message${n === 1 ? "" : "s"} (the first one ${firstWhen}). People who triggered it before now are not messaged. Did you send yourself a test?`
        : "Messages already scheduled for this automation are held and won't send while it is off. You can turn it back on any time.",
      confirmLabel: next ? "Turn on" : "Turn off",
      danger: !next,
      run: async () => {
        try {
          const j = await apiFetch<{ flow: CustomFlow }>(`/api/whatsapp/flows/custom/${f.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: next }),
          });
          setCustom((cs) => (cs ?? []).map((c) => (c.id === f.id ? j.flow : c)));
          toast.push({ kind: "success", text: `"${f.name}" is now ${next ? "on" : "off"}.` });
        } catch (e) {
          toast.push({ kind: "error", text: e instanceof Error ? e.message : "Couldn't change it." });
        }
      },
    });
  }

  function deleteCustom(f: CustomFlow) {
    setPending({
      title: `Delete "${f.name}"?`,
      body: "Messages still waiting to go out for it are cancelled. Customers who already got a message are not affected. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
      run: async () => {
        try {
          await apiFetch(`/api/whatsapp/flows/custom/${f.id}`, { method: "DELETE" });
          setCustom((cs) => (cs ?? []).filter((c) => c.id !== f.id));
          toast.push({ kind: "success", text: `Deleted "${f.name}".` });
        } catch (e) {
          toast.push({ kind: "error", text: e instanceof Error ? e.message : "Couldn't delete it." });
        }
      },
    });
  }

  function openAutomation(key: string | null) {
    setOpenKey(key);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  function showBuiltIn(card: string) {
    setView({ kind: "list" });
    openAutomation(card);
  }

  if (!draft || !saved) {
    if (flowsQ.isError) {
      return (
        <div className={s.center}>
          <span>Couldn&apos;t load automations: {flowsQ.error instanceof Error ? flowsQ.error.message : "unknown error"}</span>
          <button type="button" className="pm2-btn sm" onClick={() => flowsQ.refetch()}><RefreshCw aria-hidden="true" /> Try again</button>
        </div>
      );
    }
    return <div className={s.center}>Loading automations…</div>;
  }

  const ctx: FlowsCtx = {
    draft, saved, set, requestToggle,
    templates: tplQ.data ?? [],
    statusRows: flowsQ.data?.templates ?? [],
    stats: flowsQ.data?.stats ?? {},
    voice: voiceQ.data?.voice ?? NO_VOICE,
    isAdmin,
  };
  const orderDirty = dirtyKeys.some((k) => ORDER_MESSAGE_KEYS.has(k));

  const dialog = pending && (
    <ConfirmDialog
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      keepLabel="Cancel"
      danger={pending.danger}
      busy={busy}
      onClose={() => { if (!busy) setPending(null); }}
      onConfirm={async () => {
        setBusy(true);
        try { await pending.run(); } finally { setBusy(false); setPending(null); }
      }}
    />
  );

  if (view.kind === "builder") {
    return (
      <div className={s.wrap}>
        <FlowBuilder
          initial={view.flow}
          recipe={view.recipe}
          templates={ctx.templates}
          statusRows={ctx.statusRows}
          onCancel={() => setView({ kind: "list" })}
          onDone={(f) => {
            setCustom((cs) => {
              const list = cs ?? [];
              return list.some((c) => c.id === f.id) ? list.map((c) => (c.id === f.id ? f : c)) : [...list, f];
            });
            setView({ kind: "list" });
            flowsQ.refetch();
          }}
        />
        {dialog}
      </div>
    );
  }

  // Every automation once, keyed, so the list and the detail page render the
  // exact same component (same props, same handlers).
  const marketing: Array<[string, ReactNode]> = [
    ["abandoned_cart", <CartCard key="abandoned_cart" c={ctx} />],
    ["review", <ReviewCard key="review" c={ctx} />],
    ["restock", <RestockCard key="restock" c={ctx} />],
    ...(custom ?? []).map((f): [string, ReactNode] => [
      `custom:${f.id}`,
      <CustomFlowCard key={f.id} c={ctx} flow={f}
        onToggle={() => toggleCustom(f)}
        onEdit={() => setView({ kind: "builder", flow: f, recipe: null })}
        onDelete={() => deleteCustom(f)} />,
    ]),
  ];
  const orders: Array<[string, ReactNode]> = [
    ["confirmation", <ConfirmationCard key="confirmation" c={ctx} />],
    ["cod", <CodCard key="cod" c={ctx} />],
    ["shipping", <ShippingCard key="shipping" c={ctx} />],
    ["voice", <VoiceCard key="voice" c={ctx} />],
    ["signoff", <SignOffCard key="signoff" c={ctx} />],
  ];
  const opened = openKey ? [...marketing, ...orders].find(([k]) => k === openKey) : undefined;
  const isOrder = !!openKey && orders.some(([k]) => k === openKey);
  const onCount = [saved.abandoned_cart_enabled, saved.review_request_enabled, saved.replenishment_enabled].filter(Boolean).length
    + (custom ?? []).filter((f) => f.enabled).length;

  const rows = (items: Array<[string, ReactNode]>) => (
    <div className={s.list}>
      {items.map(([k, node]) => (
        <AutomationDisplay.Provider key={k} value={{ mode: "row", onOpen: () => openAutomation(k) }}>
          {node}
        </AutomationDisplay.Provider>
      ))}
    </div>
  );

  return (
    <div className={s.wrap}>
      {opened ? (
        <>
          {isOrder && !isAdmin && (
            <LockNote>Only the owner can change order messages because they affect every order. You can see how it works below.</LockNote>
          )}
          <AutomationDisplay.Provider value={{ mode: "detail", onBack: () => openAutomation(null) }}>
            {opened[1]}
          </AutomationDisplay.Provider>
        </>
      ) : (
        <>
          <div className={s.intro}>
            <div className={s.introText}>
              <p className={s.introSub}>
                Messages that send themselves when something happens. <b>{onCount} marketing {onCount === 1 ? "automation is" : "automations are"} on.</b>{" "}
                Open one to see its steps, change a wait or switch it off.
              </p>
            </div>
            <div className={s.introActs}>
              <button type="button" className="pm2-btn pri" onClick={() => setView({ kind: "gallery" })}>
                <Plus aria-hidden="true" /> New automation
              </button>
            </div>
          </div>

          {view.kind === "gallery" && (
            <RecipeGallery
              builtInOn={{ abandoned_cart: saved.abandoned_cart_enabled, review: saved.review_request_enabled, restock: saved.replenishment_enabled }}
              onUse={(r) => setView({ kind: "builder", flow: null, recipe: r })}
              onBlank={() => setView({ kind: "builder", flow: null, recipe: null })}
              onShowBuiltIn={showBuiltIn}
              onClose={() => setView({ kind: "list" })}
            />
          )}

          <section className={s.section} aria-labelledby="mk-title">
            <div className={s.sectionHead}>
              <h2 id="mk-title" className={s.sectionTitle}>Marketing automations</h2>
              <p className={s.sectionSub}>Reminders and offers. These count towards each person&apos;s 1 marketing message a day.</p>
            </div>
            {rows(marketing)}
            {(custom ?? []).length === 0 && (
              <p className={s.listNote}>
                No automations of your own yet. Press <strong>New automation</strong> to pick a ready-made idea.
              </p>
            )}
          </section>

          <section className={s.section} aria-labelledby="om-title">
            <div className={s.sectionHead}>
              <h2 id="om-title" className={s.sectionTitle}>Order messages</h2>
              <p className={s.sectionSub}>
                Sent for every order. Service messages, not marketing.{!isAdmin && " Only the owner can change these."}
              </p>
            </div>
            {rows(orders)}
          </section>
        </>
      )}

      {dirtyKeys.length > 0 && (
        <div className={s.saveBar} role="region" aria-label="Unsaved changes">
          <span className={s.saveNote}>
            <AlertTriangle aria-hidden="true" />
            {orderDirty ? "Unsaved changes, including order messages." : "Unsaved changes."}
          </span>
          <button type="button" className="pm2-btn" onClick={() => setDraft(saved)} disabled={saving}>Discard</button>
          <button type="button" className="pm2-btn pri" onClick={saveDraft} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
      {dialog}
    </div>
  );
}
