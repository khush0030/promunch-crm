// Voice tab data model + pure helpers. Everything here is derived from the
// rows GET /api/whatsapp/voice-calls already returns; nothing fetches.

export type CartItem = { title?: string; qty?: number };

export type VoiceCall = {
  id: string;
  purpose: string | null;
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

export type Stats = { placed: number; connected: number; linkSent: number; doNotCall: number; dialing: number };

export type SyncResult = { scanned: number; matched: number; updated: number; dndFlagged: number; dndFailed: number; unmatched: number };

export const STATUS_OPTIONS = ["dialing", "connected", "no_answer", "busy", "failed", "start_failed", "unknown"];
export const OUTCOME_OPTIONS = ["will_buy", "asked_link", "not_interested", "do_not_call", "callback_later", "confirmed", "cancel_requested", "unclear", "unknown"];

// Plain words for the call states and outcomes the voice partner reports.
const STATUS_LABEL: Record<string, string> = {
  dialing: "Calling", connected: "Picked up", no_answer: "No answer", busy: "Busy",
  failed: "Did not connect", start_failed: "Could not start", unknown: "Not known yet",
};
const OUTCOME_LABEL: Record<string, string> = {
  will_buy: "Will buy", asked_link: "Asked for the link", not_interested: "Not interested",
  do_not_call: "Asked us not to call", callback_later: "Call back later", unknown: "No clear answer",
  confirmed: "Confirmed order", cancel_requested: "Asked to cancel", unclear: "Unclear",
};
export const statusLabel = (v: string) => STATUS_LABEL[v] ?? cap(v.replace(/_/g, " "));
export const outcomeLabel = (v: string) => OUTCOME_LABEL[v] ?? cap(v.replace(/_/g, " "));
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export type Tone = "good" | "info" | "warn" | "bad" | "neu";

// One short result per call for the list and the drawer: the outcome when the
// customer said something meaningful, otherwise how the call itself went.
export function callResult(c: VoiceCall): { label: string; tone: Tone } {
  if (c.status === "start_failed") return { label: "Could not start", tone: "warn" };
  if (c.status === "failed") return { label: "Did not connect", tone: "warn" };
  if (c.status === "no_answer") return { label: "No answer", tone: "warn" };
  if (c.status === "busy") return { label: "Busy", tone: "warn" };
  if (c.status === "dialing") return { label: "Calling", tone: "info" };
  if (c.purpose === "cart" && c.order) return { label: "Ordered after", tone: "good" };
  switch (c.outcome) {
    case "confirmed": return { label: "Confirmed", tone: "good" };
    case "cancel_requested": return { label: "Asked to cancel", tone: "warn" };
    case "will_buy": return { label: "Will buy", tone: "good" };
    case "asked_link": return { label: "Asked for link", tone: "good" };
    case "callback_later": return { label: "Call back later", tone: "info" };
    case "not_interested": return { label: "Not interested", tone: "neu" };
    case "do_not_call": return { label: "Do not call", tone: "neu" };
  }
  if (c.status === "connected") return { label: "Picked up", tone: "good" };
  return { label: statusLabel(c.status), tone: "neu" };
}

export function fmtInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function fmtDur(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

// Masks a phone number for display: keeps the country code and a couple of
// digits at each end, hides the rest.
export function maskPhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 6) return digits || "-";
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : "";
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  const masked = local.slice(0, 2) + "*".repeat(Math.max(0, local.length - 4)) + local.slice(-2);
  return cc ? `+${cc} ${masked}` : masked;
}

export function cartSummary(items: CartItem[]): string {
  if (!items.length) return "";
  return items.map((i) => `${i.qty ?? 1}x ${i.title ?? "Item"}`).join(", ");
}

export function displayName(c: VoiceCall): string {
  return c.contact.name?.trim() || "Unknown customer";
}

export function isCod(c: VoiceCall): boolean {
  return c.purpose === "cod_confirm";
}

// What the call was about, in a few words: "COD #342972 · ₹749" or
// "Cart ₹748 · 2x Peri Peri Crunchies".
export function callSubject(c: VoiceCall): string {
  if (isCod(c)) {
    const amt = c.order ? ` · ${fmtInr(c.order.total_price)}` : "";
    return `COD order #${c.order_ref ?? "-"}${amt}`;
  }
  const total = c.run?.cart_total;
  const items = cartSummary(c.run?.cart_items ?? []);
  return [total != null ? `Cart ${fmtInr(total)}` : "Cart", items].filter(Boolean).join(" · ");
}

// Calls about the same thing (one COD order, or one cart journey run) are the
// tries of one call flow. Only the calls loaded on this page are known.
export function triesKey(c: VoiceCall): string {
  if (isCod(c)) return `cod:${c.order_ref ?? c.id}`;
  return `cart:${c.run?.id ?? c.order_ref ?? c.id}`;
}

export function groupTries(calls: VoiceCall[]): Map<string, VoiceCall[]> {
  const m = new Map<string, VoiceCall[]>();
  for (const c of calls) {
    const k = triesKey(c);
    const arr = m.get(k) ?? [];
    arr.push(c);
    m.set(k, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return m;
}

// ---- scorecards ---------------------------------------------------------------

export type JobScore = {
  placed: number;
  pickedUp: number;
  noAnswer: number; // no answer, busy or did not connect
  notStarted: number;
  waiting: number; // result not in yet
  // COD
  confirmed: number;
  cancelled: number;
  // cart
  interested: number;
  linkSent: number;
  ordered: number;
  orderedValue: number;
  dnd: number;
};

export function scoreJob(calls: VoiceCall[]): JobScore {
  const s: JobScore = {
    placed: calls.length, pickedUp: 0, noAnswer: 0, notStarted: 0, waiting: 0,
    confirmed: 0, cancelled: 0, interested: 0, linkSent: 0, ordered: 0, orderedValue: 0, dnd: 0,
  };
  for (const c of calls) {
    if (c.status === "connected") s.pickedUp++;
    else if (c.status === "no_answer" || c.status === "busy" || c.status === "failed") s.noAnswer++;
    else if (c.status === "start_failed") s.notStarted++;
    else if (c.status === "dialing") s.waiting++;
    if (c.outcome === "confirmed") s.confirmed++;
    if (c.outcome === "cancel_requested") s.cancelled++;
    if (c.outcome === "will_buy" || c.outcome === "asked_link") s.interested++;
    if (c.outcome === "do_not_call") s.dnd++;
    if (c.link_sent_at) s.linkSent++;
    if (c.order) { s.ordered++; s.orderedValue += Number(c.order.total_price) || 0; }
  }
  return s;
}

export function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

// Weekly buckets (Monday start) for the last `weeks` weeks, oldest first.
export function weeklyTrend(calls: VoiceCall[], weeks = 8, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dow = (start.getDay() + 6) % 7; // 0 = Monday
  start.setDate(start.getDate() - dow - (weeks - 1) * 7);
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 7);
    return { start: d, label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), placed: 0, pickedUp: 0, good: 0 };
  });
  const t0 = start.getTime();
  for (const c of calls) {
    const idx = Math.floor((new Date(c.created_at).getTime() - t0) / (7 * 86400_000));
    if (idx < 0 || idx >= weeks) continue;
    const b = buckets[idx];
    b.placed++;
    if (c.status === "connected") b.pickedUp++;
    if (c.outcome === "confirmed" || c.outcome === "will_buy" || c.outcome === "asked_link" || c.order) b.good++;
  }
  return buckets;
}

// Cart calls where the customer picked up but no order followed, grouped by
// what they said.
export function cartReasons(calls: VoiceCall[]) {
  const rows = new Map<string, number>();
  let total = 0;
  for (const c of calls) {
    if (c.purpose !== "cart" || c.status !== "connected" || c.order) continue;
    const key = c.outcome ?? "unknown";
    rows.set(key, (rows.get(key) ?? 0) + 1);
    total++;
  }
  const items = Array.from(rows.entries())
    .map(([key, n]) => ({ key, label: outcomeLabel(key), n }))
    .sort((a, b) => b.n - a.n);
  return { total, items };
}
