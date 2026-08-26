"use client";

// Flows tab: every automated WhatsApp journey, visualized and editable.
// Settings live in wa_flow_settings (singleton) via /api/whatsapp/flows;
// the edge functions read the same row, so a change here IS the live config
// (once those functions are deployed with flow-settings support).
//
// Timing changes apply to customers who ENTER a flow from then on — messages
// already scheduled keep their original send time (next_action_at is stamped
// at enrolment). Turning a flow off holds pending sends without deleting them.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, MessageSquareText,
  PackageCheck, Pencil, Plus, RefreshCw, ShoppingCart, Star, Trash2, Truck, X, Zap,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { apiFetch } from "@/lib/api-fetch";
import type { Template } from "./types";
import { cardStyle, inputStyle, primaryBtn, smallBtn } from "./styles";
import { Modal, Field } from "./primitives";

type FlowSettings = {
  order_confirmation_enabled: boolean;
  shipping_update_enabled: boolean;
  abandoned_cart_enabled: boolean;
  cart_step1_delay_hours: number;
  cart_step2_delay_hours: number;
  cart_deadline_hours: number;
  cart_backoff_hours: number;
  cart_coupon_code: string;
  review_request_enabled: boolean;
  review_delay_days: number;
  replenishment_enabled: boolean;
  replenishment_delay_days: number;
  cod_gate_enabled: boolean;
  cod_reminder_delay_hours: number;
  cod_needs_call_hours: number;
  confirmation_template_first: string;
  confirmation_template_repeat: string;
  tagline_text: string;
  tagline_bot_replies: boolean;
  tagline_proactive_asks: boolean;
  tagline_cod_gate: boolean;
  tagline_checkout_footer: boolean;
  voice_call_enabled: boolean;
  cart_voice_delay_hours: number;
  voice_min_cart_value: number;
  voice_call_start_hour: number;
  voice_call_end_hour: number;
  voice_language: string;
};
type TplRow = { name: string; language: string; status: string };
type Stats = Record<string, Record<string, number>>;

type CustomStep = { delay_hours: number; template: string; language: string; vars: Record<string, string> };
type CustomFlow = {
  id: string; name: string; enabled: boolean;
  trigger_event: "order_placed" | "order_fulfilled" | "checkout_abandoned";
  steps: CustomStep[];
};

const TRIGGER_LABELS: Record<CustomFlow["trigger_event"], { label: string; icon: typeof PackageCheck }> = {
  order_placed: { label: "Order placed", icon: PackageCheck },
  order_fulfilled: { label: "Order shipped", icon: Truck },
  checkout_abandoned: { label: "Checkout abandoned", icon: ShoppingCart },
};

const fmtDelay = (h: number) =>
  h === 0 ? "instantly" : h % 24 === 0 && h >= 24 ? `after ${h / 24} day${h === 24 ? "" : "s"}` : `after ${h}h`;

/* ---------- small building blocks ---------------------------------- */

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        width: 42, height: 24, borderRadius: 999, border: "1px solid var(--pm-border)",
        background: on ? "var(--pm-green)" : "var(--pm-card2)", cursor: "pointer",
        position: "relative", transition: "background .15s", flexShrink: 0,
      }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18,
        borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
        transition: "left .15s",
      }} />
    </button>
  );
}

function Node({ icon: Icon, title, sub, tone = "neutral" }: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: React.ReactNode; sub?: React.ReactNode; tone?: "neutral" | "green" | "brand";
}) {
  const color = tone === "green" ? "var(--pm-green)" : tone === "brand" ? "#1d4ed8" : "var(--pm-muted)";
  return (
    <div style={{
      border: "1px solid var(--pm-border)", borderRadius: 10, padding: "8px 12px",
      background: "var(--pm-card)", minWidth: 130, maxWidth: 230,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--pm-ink)" }}>
        <Icon size={13} style={{ color }} /> {title}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 3, lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

const Arrow = () => <ArrowRight size={15} style={{ color: "var(--pm-hint)", flexShrink: 0 }} />;

function NumField({ value, onChange, unit, min, max, step = 1, width = 60 }: {
  value: number; onChange: (n: number) => void; unit: string;
  min: number; max: number; step?: number; width?: number;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input type="number" value={value} min={min} max={max} step={step}
        aria-label={`delay in ${unit}`}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--pm-border)",
          fontSize: 13, fontWeight: 700, textAlign: "center", background: "var(--pm-card)",
        }} />
      <span style={{ fontSize: 12, color: "var(--pm-muted)", fontWeight: 600 }}>{unit}</span>
    </span>
  );
}

function Wait({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      border: "1px dashed var(--pm-border)", borderRadius: 10, padding: "8px 12px",
      background: "var(--pm-app)", display: "flex", alignItems: "center", gap: 7,
    }}>
      <Clock size={13} style={{ color: "var(--pm-gold)", flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: "var(--pm-muted)", display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        {children}
      </span>
    </div>
  );
}

function TplBadge({ name, templates }: { name: string; templates: TplRow[] }) {
  const t = templates.find((x) => x.name === name);
  const ok = t?.status === "approved";
  const color = ok ? "var(--pm-green)" : t ? "#92400e" : "var(--pm-terra)";
  const title = ok
    ? "Template approved at Meta"
    : t
      ? `Template status: ${t.status} — sends hold until Meta approves it`
      : "Template not found — create it in the Templates tab or sends will hold";
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color, fontWeight: 600 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, display: "inline-block" }} />
      {name}
    </span>
  );
}

function TplPicker({ label, value, templates, onChange, allowNone, noneLabel }: {
  label: string; value: string; templates: TplRow[];
  onChange: (v: string) => void; allowNone?: boolean; noneLabel?: string;
}) {
  const names = [...new Set(templates.map((t) => t.name))].sort();
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: "var(--pm-muted)", fontWeight: 600 }}>
      {label}
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, width: 250, fontSize: 12.5, fontWeight: 600 }}>
        {allowNone && <option value="">{noneLabel ?? "None"}</option>}
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
        {value !== "" && !names.includes(value) && <option value={value}>{value}</option>}
      </select>
      {value !== "" && <TplBadge name={value} templates={templates} />}
    </label>
  );
}

function StatChips({ rows }: { rows: Array<{ label: string; value: number; color?: string }> }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--pm-line)" }}>
      {rows.map((s) => (
        <span key={s.label} style={{ fontSize: 12, color: "var(--pm-muted)" }}>
          <strong style={{ color: s.color ?? "var(--pm-ink)", fontSize: 14 }}>{s.value.toLocaleString("en-IN")}</strong> {s.label}
        </span>
      ))}
      <span style={{ fontSize: 11, color: "var(--pm-hint)", marginLeft: "auto" }}>last 30 days</span>
    </div>
  );
}

function FlowCard({ title, icon: Icon, enabled, onToggle, dimmed, children }: {
  title: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  enabled: boolean; onToggle: (v: boolean) => void; dimmed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ ...cardStyle, opacity: dimmed ? 0.55 : 1, transition: "opacity .15s" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14.5 }}>
          <Icon size={16} style={{ color: "var(--pm-green)" }} /> {title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: enabled ? "var(--pm-green)" : "var(--pm-hint)" }}>
            {enabled ? "On" : "Off"}
          </span>
          <Toggle on={enabled} onChange={onToggle} label={`${title} enabled`} />
        </div>
      </div>
      {children}
    </div>
  );
}

const Timeline = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{children}</div>
);

const Footnote = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 11.5, color: "var(--pm-hint)", marginTop: 8, lineHeight: 1.5 }}>{children}</div>
);

/* ---------- the page ------------------------------------------------ */

export default function FlowsView() {
  const toast = useToast();
  const [settings, setSettings] = useState<FlowSettings | null>(null);
  const [draft, setDraft] = useState<FlowSettings | null>(null);
  const [templates, setTemplates] = useState<TplRow[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [saving, setSaving] = useState(false);
  const [custom, setCustom] = useState<CustomFlow[]>([]);
  const [builder, setBuilder] = useState<CustomFlow | "new" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    setLoadError(null);
    apiFetch<{ settings?: FlowSettings; templates?: TplRow[]; stats?: Stats; custom?: CustomFlow[] }>("/api/whatsapp/flows")
      .then((j) => {
        const s = j.settings;
        if (s) { setSettings(s); setDraft((d) => (d ? d : s)); }
        else setLoadError("Unexpected response from the flows API");
        setTemplates(j.templates ?? []);
        setStats(j.stats ?? {});
        setCustom(j.custom ?? []);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load flows"));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  async function toggleCustom(f: CustomFlow, enabled: boolean) {
    setCustom((cs) => cs.map((c) => (c.id === f.id ? { ...c, enabled } : c)));
    const r = await fetch(`/api/whatsapp/flows/custom/${f.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const j = await r.json();
    if (j.error) { toast.push({ kind: "error", text: j.error }); load(); }
  }

  async function removeCustom(f: CustomFlow) {
    if (!confirm(`Delete flow "${f.name}"? Pending messages for it are cancelled — customers already messaged are unaffected.`)) return;
    const r = await fetch(`/api/whatsapp/flows/custom/${f.id}`, { method: "DELETE" });
    const j = await r.json();
    if (j.error) toast.push({ kind: "error", text: j.error });
    load();
  }

  const dirty = useMemo(
    () => !!settings && !!draft && JSON.stringify(settings) !== JSON.stringify(draft),
    [settings, draft],
  );

  function set<K extends keyof FlowSettings>(k: K, v: FlowSettings[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }

  async function save() {
    if (!settings || !draft) return;
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(draft) as Array<keyof FlowSettings>) {
      if (draft[k] !== settings[k]) patch[k] = draft[k];
    }
    setSaving(true);
    try {
      const r = await fetch("/api/whatsapp/flows", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (j.error) { toast.push({ kind: "error", text: j.error }); return; }
      setSettings(j.settings); setDraft(j.settings);
      toast.push({ kind: "success", text: "Flow settings saved — applies to customers entering a flow from now on." });
    } finally { setSaving(false); }
  }

  if (!draft) {
    if (loadError) {
      return (
        <div style={{ padding: 32, textAlign: "center" }}>
          <div style={{ color: "var(--pm-terra)", fontSize: 13, marginBottom: 12 }}>Couldn’t load flows: {loadError}</div>
          <button type="button" style={smallBtn} onClick={load}><RefreshCw size={14} /> Retry</button>
        </div>
      );
    }
    return <div style={{ padding: 32, color: "var(--pm-hint)", fontSize: 13 }}>Loading flows…</div>;
  }

  const cart = stats.abandoned_checkout ?? {};
  const review = stats.review_request ?? {};
  const restock = stats.replenishment_reminder ?? {};

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--pm-muted)", maxWidth: 620 }}>
          Every automated WhatsApp journey, in one place. Edit a wait time or coupon and hit Save —
          changes apply to customers entering the flow from then on (already-scheduled messages keep
          their original time). Turning a flow off holds its pending messages without deleting them.
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {dirty && (
            <>
              <button type="button" style={smallBtn} onClick={() => setDraft(settings)}>Discard</button>
              <button type="button" style={smallBtn} disabled={saving} onClick={save}>
                <CheckCircle2 size={14} /> {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          )}
          <button type="button" style={primaryBtn} onClick={() => setBuilder("new")}>
            <Plus size={14} /> New flow
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {/* 1 — order confirmation */}
        <FlowCard title="Order confirmation" icon={PackageCheck}
          enabled={draft.order_confirmation_enabled} dimmed={!draft.order_confirmation_enabled}
          onToggle={(v) => set("order_confirmation_enabled", v)}>
          <Timeline>
            <Node icon={PackageCheck} title="Order placed" sub="Shopify webhook" tone="brand" />
            <Arrow />
            <Node icon={Zap} title="Instantly" sub="a few seconds after checkout" tone="green" />
            <Arrow />
            <Node icon={MessageSquareText} title="Confirmation message"
              sub={<>
                <TplBadge name={draft.confirmation_template_first} templates={templates} />
                {draft.confirmation_template_repeat !== "" &&
                  draft.confirmation_template_repeat !== draft.confirmation_template_first && (
                  <div style={{ marginTop: 2 }}>
                    returning: <TplBadge name={draft.confirmation_template_repeat} templates={templates} />
                  </div>
                )}
              </>} tone="green" />
          </Timeline>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12 }}>
            <TplPicker label="First order template" value={draft.confirmation_template_first}
              templates={templates} onChange={(v) => set("confirmation_template_first", v)} />
            <TplPicker label="Returning customer template" value={draft.confirmation_template_repeat}
              templates={templates} allowNone noneLabel="Same as first order"
              onChange={(v) => set("confirmation_template_repeat", v)} />
          </div>
          <Footnote>
            Utility message — no marketing cap, no coupon. If the first send fails, a sweep retries
            every 15 minutes for up to 24 hours. Duplicates are impossible by design (atomic per-order claim).
            A customer whose phone number has an earlier order counts as returning; if the returning
            template is unset or not yet approved at Meta, everyone gets the first-order template.
            Both templates must use variables {"{{1}}"} = name and {"{{2}}"} = order number.
          </Footnote>
        </FlowCard>

        {/* 1b — COD confirmation gate */}
        <FlowCard title="COD confirmation gate" icon={PackageCheck}
          enabled={draft.cod_gate_enabled} dimmed={!draft.cod_gate_enabled}
          onToggle={(v) => set("cod_gate_enabled", v)}>
          <Timeline>
            <Node icon={PackageCheck} title="COD order placed" sub="held for confirmation" tone="brand" />
            <Arrow />
            <Wait>
              after
              <NumField value={draft.cod_reminder_delay_hours} min={0.5} max={48} step={0.5} unit="h"
                onChange={(n) => set("cod_reminder_delay_hours", n)} />
            </Wait>
            <Arrow />
            <Node icon={MessageSquareText} title="Confirm reminder" sub="ask the customer to confirm on WhatsApp" tone="green" />
            <Arrow />
            <Wait>
              at
              <NumField value={draft.cod_needs_call_hours} min={1} max={168} unit="h"
                onChange={(n) => set("cod_needs_call_hours", n)} />
              without a reply
            </Wait>
            <Arrow />
            <Node icon={AlertTriangle} title="Needs a call" sub="escalated for manual confirmation" tone="neutral" />
          </Timeline>
          <Footnote>
            COD orders are held until the customer confirms on WhatsApp — reduces RTO on unconfirmed
            cash-on-delivery orders. The escalation hour must be after the reminder hour.
          </Footnote>
        </FlowCard>

        {/* 2 — shipping update */}
        <FlowCard title="Shipping update" icon={Truck}
          enabled={draft.shipping_update_enabled} dimmed={!draft.shipping_update_enabled}
          onToggle={(v) => set("shipping_update_enabled", v)}>
          <Timeline>
            <Node icon={Truck} title="Order fulfilled" sub="Shopify marks it shipped" tone="brand" />
            <Arrow />
            <Node icon={Zap} title="Instantly" tone="green" />
            <Arrow />
            <Node icon={MessageSquareText} title="Tracking link"
              sub={<TplBadge name="shipping_update" templates={templates} />} tone="green" />
          </Timeline>
          <Footnote>
            Links to the Shopify order-status page. Exactly one message per shipment — a second
            fulfillment (split order) gets its own update.
          </Footnote>
        </FlowCard>

        {/* 3 — abandoned cart */}
        <FlowCard title="Abandoned cart recovery" icon={ShoppingCart}
          enabled={draft.abandoned_cart_enabled} dimmed={!draft.abandoned_cart_enabled}
          onToggle={(v) => set("abandoned_cart_enabled", v)}>
          <Timeline>
            <Node icon={ShoppingCart} title="Checkout abandoned" sub="phone number captured" tone="brand" />
            <Arrow />
            <Wait>
              after
              <NumField value={draft.cart_step1_delay_hours} min={0.25} max={168} step={0.5} unit="h"
                onChange={(n) => set("cart_step1_delay_hours", n)} />
            </Wait>
            <Arrow />
            <Node icon={MessageSquareText} title="Reminder" sub={<>
              cart link, <strong>no coupon</strong> · <TplBadge name="abandoned_cart_reminder" templates={templates} />
            </>} tone="green" />
            <Arrow />
            <Wait>
              at
              <NumField value={draft.cart_step2_delay_hours} min={0.5} max={336} step={0.5} unit="h"
                onChange={(n) => set("cart_step2_delay_hours", n)} />
              after abandonment
            </Wait>
            <Arrow />
            <Node icon={MessageSquareText} title="Coupon nudge" sub={<>
              code{" "}
              <input value={draft.cart_coupon_code} aria-label="Cart coupon code"
                onChange={(e) => set("cart_coupon_code", e.target.value.toUpperCase())}
                style={{
                  width: 110, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--pm-border)",
                  fontSize: 11.5, fontWeight: 700, background: "var(--pm-card)", letterSpacing: 0.4,
                }} />
              {" "}· <TplBadge name="abandoned_cart_recovery" templates={templates} />
            </>} tone="green" />
          </Timeline>
          <Footnote>
            Keeps retrying until <strong>one</strong> message is actually delivered or{" "}
            <NumField value={draft.cart_deadline_hours} min={6} max={720} step={6} unit="h"
              onChange={(n) => set("cart_deadline_hours", n)} />{" "}
            after abandonment, whichever comes first. Rejected sends (Meta&apos;s marketing cap) retry every{" "}
            <NumField value={draft.cart_backoff_hours} min={1} max={72} unit="h" width={52}
              onChange={(n) => set("cart_backoff_hours", n)} />. When the customer&apos;s 24h chat window
            is open, it sends a personal free-text nudge instead (cap-immune). The whole flow stops
            the moment they order, and never messages the same cart twice.
          </Footnote>
          <StatChips rows={[
            { label: "delivered", value: cart.completed ?? 0, color: "var(--pm-green)" },
            { label: "recovered (ordered)", value: cart.converted ?? 0, color: "var(--pm-green)" },
            { label: "still trying", value: cart.active ?? 0, color: "var(--pm-gold)" },
            { label: "missed (deadline passed)", value: cart.expired ?? 0, color: (cart.expired ?? 0) > 0 ? "var(--pm-terra)" : "var(--pm-hint)" },
          ]} />
        </FlowCard>

        {/* 4 — review request */}
        <FlowCard title="Review request" icon={Star}
          enabled={draft.review_request_enabled} dimmed={!draft.review_request_enabled}
          onToggle={(v) => set("review_request_enabled", v)}>
          <Timeline>
            <Node icon={PackageCheck} title="Order placed" tone="brand" />
            <Arrow />
            <Wait>
              wait
              <NumField value={draft.review_delay_days} min={1} max={90} unit="days"
                onChange={(n) => set("review_delay_days", n)} />
            </Wait>
            <Arrow />
            <Node icon={Star} title="Ask for a review" sub={<>
              personal in-chat ask preferred · fallback <TplBadge name="review_request" templates={templates} />
            </>} tone="green" />
          </Timeline>
          <Footnote>
            Prefers a personal, AI-composed ask inside an open 24h chat window (names their actual
            products, dodges the marketing cap). Falls back to the template at most 3 times, then
            waits for the next open window. Skipped automatically if the order was cancelled or the
            customer has an open support ticket.
          </Footnote>
          <StatChips rows={[
            { label: "asked", value: review.completed ?? 0, color: "var(--pm-green)" },
            { label: "waiting", value: review.active ?? 0, color: "var(--pm-gold)" },
            { label: "skipped (cancelled)", value: review.cancelled ?? 0 },
          ]} />
        </FlowCard>

        {/* 5 — restock reminder */}
        <FlowCard title="Restock reminder" icon={RefreshCw}
          enabled={draft.replenishment_enabled} dimmed={!draft.replenishment_enabled}
          onToggle={(v) => set("replenishment_enabled", v)}>
          <Timeline>
            <Node icon={PackageCheck} title="Order placed" tone="brand" />
            <Arrow />
            <Wait>
              wait
              <NumField value={draft.replenishment_delay_days} min={1} max={365} unit="days"
                onChange={(n) => set("replenishment_delay_days", n)} />
            </Wait>
            <Arrow />
            <Node icon={RefreshCw} title="Time to restock?" sub={<>
              personal in-chat ask preferred · fallback <TplBadge name="replenishment_reminder" templates={templates} />
            </>} tone="green" />
          </Timeline>
          <Footnote>
            Same delivery rules as the review ask: free text in an open window first, capped template
            fallback, paused during open tickets, dropped if the order was cancelled.
          </Footnote>
          <StatChips rows={[
            { label: "nudged", value: restock.completed ?? 0, color: "var(--pm-green)" },
            { label: "waiting", value: restock.active ?? 0, color: "var(--pm-gold)" },
            { label: "skipped (cancelled)", value: restock.cancelled ?? 0 },
          ]} />
        </FlowCard>

        {/* 6 — brand voice */}
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>
            <MessageSquareText size={16} style={{ color: "var(--pm-green)" }} /> Brand voice
          </div>
          <div style={{ fontSize: 12, color: "var(--pm-hint)", marginBottom: 12 }}>
            The sign-off added to messages the system writes itself. Pick where it appears — or clear
            the text to drop it everywhere.
          </div>
          <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: "var(--pm-muted)", fontWeight: 600, maxWidth: 280 }}>
            Sign-off tagline
            <input value={draft.tagline_text} maxLength={60} aria-label="Sign-off tagline"
              placeholder="e.g. Your Munchy Pal 💚"
              onChange={(e) => set("tagline_text", e.target.value)}
              style={{ ...inputStyle, fontSize: 12.5 }} />
          </label>
          <div style={{ display: "grid", gap: 10, marginTop: 14, maxWidth: 560 }}>
            {([
              ["tagline_bot_replies", "Chat assistant replies", "opening greeting and closing message only, never mid-conversation"],
              ["tagline_proactive_asks", "Review, restock and cart nudges", "the personalised free-text asks sent inside an open 24h window"],
              ["tagline_cod_gate", "COD confirmation chat", "the confirm / cancel conversation on cash-on-delivery orders"],
              ["tagline_checkout_footer", "In-chat checkout message", "the small footer under the secure checkout-link message"],
            ] as const).map(([key, label, sub]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--pm-ink)" }}>{label}</div>
                  <div style={{ fontSize: 11, color: "var(--pm-hint)" }}>{sub}</div>
                </div>
                <Toggle on={draft[key]} onChange={(v) => set(key, v)} label={`${label} sign-off`} />
              </div>
            ))}
          </div>
          <Footnote>
            Applies to free-text messages only. Copy inside Meta-approved templates (order confirmation,
            cart reminders) is edited in the Templates tab — edits there go back through Meta review.
          </Footnote>
        </div>
      </div>

      {/* user-created flows */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)", margin: "20px 0 10px", textTransform: "uppercase", letterSpacing: 0.4 }}>
        Your flows
      </div>
      {custom.length === 0 && (
        <div style={{ ...cardStyle, color: "var(--pm-hint)", fontSize: 13 }}>
          No custom flows yet. Hit <strong>New flow</strong> to build one — pick a trigger (order placed /
          shipped / checkout abandoned), add one or more timed messages using your approved templates, and it
          runs automatically with the same no-duplicate guarantees as the built-ins.
        </div>
      )}
      <div style={{ display: "grid", gap: 12 }}>
        {custom.map((f) => {
          const trig = TRIGGER_LABELS[f.trigger_event] ?? TRIGGER_LABELS.order_placed;
          const st = stats[`custom:${f.id}`] ?? {};
          return (
            <FlowCard key={f.id} title={f.name} icon={trig.icon}
              enabled={f.enabled} dimmed={!f.enabled}
              onToggle={(v) => toggleCustom(f, v)}>
              <Timeline>
                <Node icon={trig.icon} title={trig.label} sub="Shopify webhook" tone="brand" />
                {f.steps.map((s, i) => (
                  <span key={i} style={{ display: "contents" }}>
                    <Arrow />
                    <Wait>{fmtDelay(Number(s.delay_hours))}</Wait>
                    <Arrow />
                    <Node icon={MessageSquareText} title={`Message ${i + 1}`}
                      sub={<TplBadge name={s.template} templates={templates} />} tone="green" />
                  </span>
                ))}
              </Timeline>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button type="button" style={smallBtn} onClick={() => setBuilder(f)}>
                  <Pencil size={12} /> Edit
                </button>
                <button type="button" style={{ ...smallBtn, color: "var(--pm-terra)" }}
                  aria-label={`Delete flow ${f.name}`} onClick={() => removeCustom(f)}>
                  <Trash2 size={12} />
                </button>
              </div>
              <StatChips rows={[
                { label: "sent", value: st.completed ?? 0, color: "var(--pm-green)" },
                { label: "waiting", value: st.active ?? 0, color: "var(--pm-gold)" },
                { label: "failed", value: st.failed ?? 0, color: (st.failed ?? 0) > 0 ? "var(--pm-terra)" : "var(--pm-hint)" },
                { label: "stopped (ordered/cancelled)", value: (st.converted ?? 0) + (st.cancelled ?? 0) },
              ]} />
            </FlowCard>
          );
        })}
      </div>

      {builder && (
        <CustomFlowBuilder
          initial={builder === "new" ? null : builder}
          onClose={(changed) => { setBuilder(null); if (changed) load(); }}
        />
      )}

      {dirty && (
        <div style={{
          position: "sticky", bottom: 12, marginTop: 14, display: "flex", justifyContent: "flex-end",
          gap: 8, background: "var(--pm-card)", border: "1px solid var(--pm-border)", borderRadius: 12,
          padding: 10, boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
        }}>
          <span style={{ fontSize: 12, color: "var(--pm-muted)", alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <AlertTriangle size={13} style={{ color: "var(--pm-gold)" }} /> Unsaved changes
          </span>
          <button type="button" style={smallBtn} onClick={() => setDraft(settings)}>Discard</button>
          <button type="button" style={primaryBtn} disabled={saving} onClick={save}>
            <CheckCircle2 size={14} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- flow builder modal -------------------------------------- */

const VAR_HINT = "{name} = customer's first name · {order_ref} = order number · {checkout_url} = cart recovery link (checkout trigger only)";

function CustomFlowBuilder({ initial, onClose }: {
  initial: CustomFlow | null;
  onClose: (changed: boolean) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [trigger, setTrigger] = useState<CustomFlow["trigger_event"]>(initial?.trigger_event ?? "order_placed");
  const [steps, setSteps] = useState<CustomStep[]>(
    initial?.steps?.length
      ? initial.steps.map((s) => ({ ...s, vars: { ...(s.vars ?? {}) } }))
      : [{ delay_hours: 24, template: "", language: "en", vars: {} }],
  );
  const [approved, setApproved] = useState<Template[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/whatsapp/templates?status=approved")
      .then((r) => r.json()).then((j) => setApproved(j.templates ?? [])).catch(() => {});
  }, []);

  const tplByName = useMemo(() => new Map(approved.map((t) => [t.name, t])), [approved]);
  const varsOf = (tplName: string) => {
    const body = tplByName.get(tplName)?.body ?? "";
    return Array.from(new Set((body.match(/\{\{(\d+)\}\}/g) ?? []).map((m) => m.replace(/[{}]/g, ""))));
  };

  function setStep(i: number, patch: Partial<CustomStep>) {
    setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  async function save() {
    if (!name.trim()) { toast.push({ kind: "error", text: "Give the flow a name." }); return; }
    if (steps.some((s) => !s.template)) { toast.push({ kind: "error", text: "Pick a template for every message." }); return; }
    const missing = steps.flatMap((s, i) =>
      varsOf(s.template).filter((n) => !(s.vars[n] ?? "").trim()).map((n) => `message ${i + 1} {{${n}}}`));
    if (missing.length) { toast.push({ kind: "error", text: `Fill ${missing.join(", ")} — empty values fail at Meta.` }); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        trigger_event: trigger,
        enabled: initial?.enabled ?? true,
        steps: steps.map((s) => ({
          delay_hours: Number(s.delay_hours),
          template: s.template,
          language: tplByName.get(s.template)?.language ?? s.language ?? "en",
          vars: Object.fromEntries(varsOf(s.template).map((n) => [n, s.vars[n] ?? ""])),
        })),
      };
      const r = await fetch(initial ? `/api/whatsapp/flows/custom/${initial.id}` : "/api/whatsapp/flows/custom", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.error) { toast.push({ kind: "error", text: j.error }); return; }
      toast.push({
        kind: "success",
        text: initial
          ? `Flow "${name.trim()}" updated — applies to customers entering it from now on.`
          : `Flow "${name.trim()}" is live — customers hitting the trigger from now on will get it.`,
      });
      onClose(true);
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={() => onClose(false)} title={initial ? "Edit flow" : "New flow"}>
      <Field label="Flow name (internal — customers never see it)">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Post-delivery cross-sell" style={inputStyle} />
      </Field>
      <Field label="Trigger — what starts the flow">
        <select aria-label="Flow trigger" value={trigger} disabled={!!initial}
          onChange={(e) => setTrigger(e.target.value as CustomFlow["trigger_event"])} style={inputStyle}>
          <option value="order_placed">Order placed</option>
          <option value="order_fulfilled">Order shipped (fulfilled)</option>
          <option value="checkout_abandoned">Checkout abandoned (has phone)</option>
        </select>
        {!!initial && <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 4 }}>
          The trigger can&apos;t change on an existing flow — make a new flow instead.
        </div>}
      </Field>

      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Messages (up to 5, delays measured from the trigger)</div>
      {approved.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--pm-terra)", marginBottom: 10 }}>
          No approved templates yet — create one in the Templates tab first.
        </div>
      )}
      {steps.map((s, i) => (
        <div key={i} style={{ border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10, marginBottom: 8, background: "var(--pm-app)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pm-muted)" }}>#{i + 1}</span>
            <Clock size={13} style={{ color: "var(--pm-gold)" }} />
            <span style={{ fontSize: 12, color: "var(--pm-muted)" }}>after</span>
            <input type="number" min={0} max={2160} step={1} value={s.delay_hours}
              aria-label={`Message ${i + 1} delay in hours`}
              onChange={(e) => setStep(i, { delay_hours: Number(e.target.value) })}
              style={{ ...inputStyle, width: 80, marginBottom: 0, textAlign: "center", fontWeight: 700 }} />
            <span style={{ fontSize: 12, color: "var(--pm-muted)" }}>
              hours{Number(s.delay_hours) >= 24 ? ` (= ${Math.round((Number(s.delay_hours) / 24) * 10) / 10} days)` : ""}
            </span>
            {steps.length > 1 && (
              <button type="button" aria-label={`Remove message ${i + 1}`}
                onClick={() => setSteps((ss) => ss.filter((_, j) => j !== i))}
                style={{ ...smallBtn, marginLeft: "auto", color: "var(--pm-terra)" }}>
                <X size={13} />
              </button>
            )}
          </div>
          <select aria-label={`Message ${i + 1} template`} value={s.template}
            onChange={(e) => setStep(i, { template: e.target.value, vars: {} })}
            style={{ ...inputStyle, marginBottom: 6 }}>
            <option value="">— pick an approved template —</option>
            {approved.map((t) => <option key={t.id} value={t.name}>{t.name} ({t.language})</option>)}
          </select>
          {varsOf(s.template).map((n) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, width: 38, color: "var(--pm-green)" }}>{`{{${n}}}`}</span>
              <input value={s.vars[n] ?? ""} placeholder="value — supports {name}, {order_ref}, {checkout_url}"
                onChange={(e) => setStep(i, { vars: { ...s.vars, [n]: e.target.value } })}
                style={{ ...inputStyle, marginBottom: 0 }} />
            </div>
          ))}
          {s.template && tplByName.get(s.template)?.body && (
            <div style={{ fontSize: 11.5, color: "var(--pm-muted)", whiteSpace: "pre-wrap", marginTop: 4, lineHeight: 1.4 }}>
              {(tplByName.get(s.template)!.body).replace(/\{\{(\d+)\}\}/g, (_, n) => s.vars[n] || `{{${n}}}`)}
            </div>
          )}
        </div>
      ))}
      {steps.length < 5 && (
        <button type="button" style={{ ...smallBtn, marginBottom: 12 }}
          onClick={() => setSteps((ss) => [...ss, {
            delay_hours: Math.max(24, Number(ss[ss.length - 1]?.delay_hours ?? 0) + 24),
            template: "", language: "en", vars: {},
          }])}>
          <Plus size={13} /> Add another message
        </button>
      )}

      <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 12, lineHeight: 1.5 }}>
        {VAR_HINT}. Each customer enters a flow at most once per order/checkout (no duplicates, ever).
        Checkout flows stop automatically when the customer orders; order flows stop if the order is cancelled.
        Customers with an open support ticket are paused, not messaged.
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" style={smallBtn} onClick={() => onClose(false)}>Cancel</button>
        <button type="button" style={primaryBtn} disabled={saving || approved.length === 0} onClick={save}>
          <CheckCircle2 size={14} /> {saving ? "Saving…" : initial ? "Save flow" : "Create flow"}
        </button>
      </div>
    </Modal>
  );
}
