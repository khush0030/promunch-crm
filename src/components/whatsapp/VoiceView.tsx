"use client";

// Voice tab: the Sarvam voice-agent rescue call, in one place. Settings live
// in the Flows tab (wa_flow_settings.voice_call_enabled); the cart-recovery
// funnel shows four summary chips; this tab shows the actual calls, with
// transcripts, recordings and a manual backfill from Sarvam's analytics API
// (voice-calls/sync) because Sarvam's post-call webhook is not currently
// reaching us — every voice_calls row otherwise sits on 'dialing' forever.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, ExternalLink, Phone, PhoneOff, RefreshCw, Search, ShoppingCart, User as UserIcon,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { apiFetch } from "@/lib/api-fetch";
import { timeAgo } from "@/app/dashboard/whatsapp/format";
import { cardStyle, inputStyle, primaryBtn, chip } from "./styles";

type CartItem = { title?: string; qty?: number };

type VoiceCall = {
  id: string;
  wa_id: string;
  order_ref: string | null;
  interaction_id: string | null;
  status: string;
  outcome: string | null;
  duration_s: number | null;
  failure_reason: string | null;
  transcript: Array<{ role: "agent" | "user"; en_text: string }> | null;
  link_sent_at: string | null;
  created_at: string;
  has_recording: boolean;
  contact: { wa_id: string; name: string | null; phone: string | null; voice_dnd: boolean };
  crm_contact_id: string | null;
  run: {
    id: string;
    status: string;
    order_ref: string | null;
    delivered_at: string | null;
    cart_total: number | null;
    cart_items: CartItem[];
    checkout_url: string | null;
  } | null;
  order: { order_number: number; total_price: number; financial_status: string | null; admin_url: string | null } | null;
};

type Stats = { placed: number; connected: number; linkSent: number; doNotCall: number; dialing: number };

type SyncResult = { scanned: number; matched: number; updated: number; dndFlagged: number; unmatched: number };

const STATUS_OPTIONS = ["dialing", "connected", "no_answer", "busy", "failed", "start_failed", "unknown"];
const OUTCOME_OPTIONS = ["will_buy", "asked_link", "not_interested", "do_not_call", "callback_later", "unknown"];

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  dialing: { bg: "rgba(59,130,246,0.10)", color: "#1d4ed8" },
  connected: { bg: "rgba(16,185,129,0.14)", color: "var(--pm-green)" },
  no_answer: { bg: "rgba(229,231,235,0.7)", color: "var(--pm-muted)" },
  busy: { bg: "rgba(245,183,49,0.16)", color: "#92400e" },
  failed: { bg: "rgba(239,68,68,0.12)", color: "var(--pm-terra)" },
  start_failed: { bg: "rgba(239,68,68,0.12)", color: "var(--pm-terra)" },
  unknown: { bg: "rgba(229,231,235,0.7)", color: "var(--pm-muted)" },
};

function fmtInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

// Masks a phone number for display in a list view: keeps the country code
// and a couple of digits at each end, hides the rest.
function maskPhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 6) return digits || "-";
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : "";
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  const masked = local.slice(0, 2) + "*".repeat(Math.max(0, local.length - 4)) + local.slice(-2);
  return cc ? `+${cc} ${masked}` : masked;
}

function cartSummary(items: CartItem[]): string {
  if (!items.length) return "";
  return items.map((i) => `${i.qty ?? 1}x ${i.title ?? "Item"}`).join(", ");
}

function StatChips({ rows }: { rows: Array<{ label: string; value: number; color?: string }> }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {rows.map((s) => (
        <span key={s.label} style={{ fontSize: 12, color: "var(--pm-muted)" }}>
          <strong style={{ color: s.color ?? "var(--pm-ink)", fontSize: 14 }}>{s.value.toLocaleString("en-IN")}</strong> {s.label}
        </span>
      ))}
    </div>
  );
}

const GRID_COLS = "78px 1.5fr 1.3fr 96px 130px 110px 64px";

export default function VoiceView() {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [outcome, setOutcome] = useState("");
  const [q, setQ] = useState("");
  const [syncing, setSyncing] = useState(false);

  const { data: flowsData } = useQuery({
    queryKey: ["wa-flows-settings", "voice"],
    queryFn: () => apiFetch<{ settings: { voice_call_enabled: boolean } }>("/api/whatsapp/flows"),
    staleTime: 30_000,
  });
  const voiceEnabled = flowsData?.settings?.voice_call_enabled ?? null;

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (outcome) p.set("outcome", outcome);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [status, outcome, q]);

  const { data, isLoading } = useQuery({
    queryKey: ["voice-calls", status, outcome, q],
    queryFn: () => apiFetch<{ calls: VoiceCall[]; stats: Stats }>(`/api/whatsapp/voice-calls${qs ? `?${qs}` : ""}`),
    refetchInterval: 30_000,
  });

  const calls = data?.calls ?? [];
  const stats = data?.stats ?? { placed: 0, connected: 0, linkSent: 0, doNotCall: 0, dialing: 0 };
  const hasFilters = !!(status || outcome || q.trim());
  const allStillDialing = calls.length > 0 && calls.every((c) => c.status === "dialing");

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await apiFetch<SyncResult>("/api/whatsapp/voice-calls/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: 24 }),
      });
      toast.push({
        kind: "success",
        text: `Synced from Sarvam. Scanned ${res.scanned}, matched ${res.matched}, updated ${res.updated}${
          res.dndFlagged ? `, ${res.dndFlagged} marked do-not-call` : ""
        }.`,
      });
      qc.invalidateQueries({ queryKey: ["voice-calls"] });
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Sync failed." });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div style={{ ...cardStyle, marginBottom: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, justifyContent: "space-between" }}>
        <StatChips
          rows={[
            { label: "placed", value: stats.placed, color: "var(--pm-ink)" },
            { label: "connected", value: stats.connected, color: "var(--pm-green)" },
            { label: "link sent", value: stats.linkSent, color: "var(--pm-gold)" },
            { label: "do-not-call", value: stats.doNotCall, color: "var(--pm-terra)" },
            { label: "still dialing", value: stats.dialing, color: "#1d4ed8" },
          ]}
        />
        <button type="button" style={primaryBtn} onClick={handleSync} disabled={syncing}>
          <RefreshCw size={14} /> {syncing ? "Syncing..." : "Sync from Sarvam"}
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, width: 160 }}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ ...inputStyle, width: 180 }}>
          <option value="">All outcomes</option>
          {OUTCOME_OPTIONS.map((o) => (
            <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
          ))}
        </select>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--pm-hint)" }} />
          <input
            aria-label="Search by number or name"
            placeholder="Search number or name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ ...inputStyle, paddingLeft: 30 }}
          />
        </div>
      </div>

      {voiceEnabled === false && (
        <div style={{ ...cardStyle, marginBottom: 14, background: "rgba(245,183,49,0.10)", borderColor: "var(--pm-gold)" }}>
          <strong>Voice calling is switched off.</strong> Turn it on in the Flows tab to place rescue calls. Past calls still show below.
        </div>
      )}

      {allStillDialing && (
        <div style={{ ...cardStyle, marginBottom: 14, background: "rgba(59,130,246,0.08)" }}>
          These calls have not been finalised yet because the Sarvam webhook is not reaching us. Use Sync from Sarvam above to pull the real results.
        </div>
      )}

      {isLoading ? (
        <div style={{ ...cardStyle, textAlign: "center", color: "var(--pm-hint)" }}>Loading...</div>
      ) : calls.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: "var(--pm-hint)" }}>
          {hasFilters ? "No calls match these filters." : "No voice calls yet."}
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: 8, fontSize: 11, fontWeight: 700, color: "var(--pm-hint)", textTransform: "uppercase", letterSpacing: 0.4, padding: "0 10px 8px", borderBottom: "1px solid var(--pm-line)" }}>
            <span>When</span>
            <span>Customer</span>
            <span>Cart</span>
            <span>Status</span>
            <span>Outcome</span>
            <span>Link sent</span>
            <span>Duration</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {calls.map((c) => <CallRow key={c.id} call={c} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function CallRow({ call: c }: { call: VoiceCall }) {
  const st = STATUS_STYLE[c.status] ?? STATUS_STYLE.unknown;
  const cartTotal = c.run?.cart_total ?? null;
  const cartItems = c.run?.cart_items ?? [];

  return (
    <details style={{ borderBottom: "1px solid var(--pm-line)" }}>
      <summary style={{ cursor: "pointer", padding: "10px", listStyle: "none" }}>
        <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <span style={{ color: "var(--pm-hint)" }}>{timeAgo(c.created_at)}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.contact.name || "Unknown"} <span style={{ color: "var(--pm-hint)" }}>{maskPhone(c.contact.phone || c.contact.wa_id)}</span>
            </span>
            {c.contact.voice_dnd && (
              <span style={{ ...chip, padding: "2px 7px", fontSize: 10, color: "var(--pm-terra)", borderColor: "var(--pm-terra)" }}>
                <PhoneOff size={10} /> DND
              </span>
            )}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cartSummary(cartItems)}>
            {cartTotal != null ? <strong>{fmtInr(cartTotal)}</strong> : "-"}
            {cartItems.length > 0 && <span style={{ color: "var(--pm-hint)" }}> · {cartSummary(cartItems)}</span>}
          </span>
          <span style={{ padding: "3px 8px", borderRadius: 999, background: st.bg, color: st.color, fontWeight: 600, fontSize: 11, width: "fit-content" }}>
            {c.status.replace(/_/g, " ")}
          </span>
          <span style={{ color: "var(--pm-muted)" }}>{c.outcome ? c.outcome.replace(/_/g, " ") : "-"}</span>
          <span style={{ color: "var(--pm-muted)" }}>
            {c.link_sent_at ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--pm-green)" }}>
                <CheckCircle2 size={13} /> {timeAgo(c.link_sent_at)}
              </span>
            ) : "-"}
          </span>
          <span style={{ color: "var(--pm-muted)" }}>{c.duration_s != null ? `${c.duration_s}s` : "-"}</span>
        </div>
      </summary>

      <div style={{ padding: "0 10px 14px 10px" }}>
        {c.failure_reason && (
          <div style={{ fontSize: 11.5, color: "var(--pm-terra)", marginBottom: 8 }}>Failure reason: {c.failure_reason}</div>
        )}

        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--pm-hint)", textTransform: "uppercase", letterSpacing: 0.4, margin: "6px 0" }}>
          Transcript
        </div>
        {c.transcript?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
            {c.transcript.map((t, i) => (
              <div key={i} style={{ fontSize: 12 }}>
                <strong>{t.role === "agent" ? "PROMUNCH" : "Customer"}:</strong> {t.en_text}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--pm-hint)", marginBottom: 10 }}>No transcript. Try Sync from Sarvam.</div>
        )}

        {c.has_recording && (
          <div style={{ marginBottom: 10 }}>
            <audio controls style={{ width: "100%", maxWidth: 420 }} src={`/api/whatsapp/voice-calls/${c.id}/recording`} />
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12 }}>
          {c.crm_contact_id && (
            <a href={`/dashboard/contacts/${c.crm_contact_id}`} style={{ color: "var(--pm-green)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <UserIcon size={12} /> CRM contact <ExternalLink size={10} />
            </a>
          )}
          {c.order && (
            <a href={c.order.admin_url ?? undefined} target={c.order.admin_url ? "_blank" : undefined} rel="noreferrer"
              style={{ color: "var(--pm-green)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4, pointerEvents: c.order.admin_url ? "auto" : "none" }}>
              <ShoppingCart size={12} /> Order #{c.order.order_number}, {fmtInr(c.order.total_price)} {c.order.admin_url && <ExternalLink size={10} />}
            </a>
          )}
          {c.run?.checkout_url && (
            <a href={c.run.checkout_url} target="_blank" rel="noreferrer" style={{ color: "var(--pm-green)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Phone size={12} /> Checkout link the call was about <ExternalLink size={10} />
            </a>
          )}
        </div>
        {c.order && (
          <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 6 }}>
            Likely order placed after this call, matched by phone and timing. Not proof the call caused it.
          </div>
        )}
      </div>
    </details>
  );
}
