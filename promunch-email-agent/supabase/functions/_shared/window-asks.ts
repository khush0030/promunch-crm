// 24-hour customer-service-window delivery for post-purchase asks.
//
// WHY: review_request, replenishment_reminder and abandoned_checkout are all
// MARKETING templates, so Meta throttles them per-recipient (error 131049 —
// "healthy ecosystem engagement"). In production that path is 84% blocked. But
// when a customer has messaged us in the last 24h, that service window is OPEN
// and we may send FREE-FORM text instead of a template — no marketing cap, no
// template fee, ~99% delivered, and the copy can be richly personalized with
// the customer's name and the actual products they bought.
//
// This module is the shared spine for both delivery paths:
//   - wa-journey-tick (cron): when an ask is due AND the window is open, deliver
//     it as personalized free text instead of the capped template.
//   - wa-ai-reply (inbound): when the customer messages us for any reason and an
//     ask is due, the bot weaves the personalized ask into its reply.
//
// NO-SPAM (non-negotiable, see CLAUDE.md §0): the wa_journey_runs row IS the
// dedup ledger. claimAsk() flips it active -> completed in a single atomic
// UPDATE, so exactly one path can ever deliver a given ask; the template timer
// stands down the moment the row leaves 'active'. A failed in-window send calls
// releaseAsk() to hand the claim back so the ask is retried, never lost.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { logConnector } from "./connector-log.ts";

// Journeys whose DUE run may be delivered as cap-immune free text when the 24h
// service window is open. This is BOTH the tick's window-delivery set and the
// inbound weave set — the two lists converged once abandoned_checkout joined
// the weave, because a live cart is the single most valuable thing we can put
// in front of a customer who just opened their own window by messaging us.
export const WINDOW_DELIVER_JOURNEYS = [
  "review_request",
  "replenishment_reminder",
  "abandoned_checkout",
] as const;

// Which ask wins when several are due at the same moment. A live cart is
// time-critical (it has a 72h deadline and a real basket behind it), a review
// ask is worth more than a restock nudge, and a restock nudge can always wait
// for the next window. Lower number = delivered first. Exactly ONE ask is ever
// woven into a reply, so this ordering IS the "which one" decision.
const ASK_PRIORITY: Record<string, number> = {
  abandoned_checkout: 0,
  review_request: 1,
  replenishment_reminder: 2,
};

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

// Is the customer's 24h service window still open? (open = they messaged us
// within the last 24h). Bias to CLOSED on any missing/garbage timestamp so we
// never send free-form into a closed window (which Meta would reject).
export function sessionOpen(lastInboundAt: string | null | undefined, nowMs: number): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) && nowMs - t < SESSION_WINDOW_MS;
}

export interface DueAsk {
  runId: string;
  journeyKey: string;
  orderRef: string | null;
  url: string;   // review link / site link / cart recovery checkout, from context.vars["2"]
  name: string;  // first-name hint, from context.vars["1"]
}

// wa_journey_runs.context is free-form jsonb, so PostgREST hands it back
// loosely typed. Narrow it once here rather than casting at each use site:
// vars carries {"1": name, "2": link}; anything else is treated as absent.
function runVars(context: unknown): Record<string, string> {
  const v = (context as { vars?: unknown } | null)?.vars;
  return v && typeof v === "object" ? v as Record<string, string> : {};
}

// The single best in-window ask that is DUE for this customer, or null.
//
// Only ONE ask is ever returned: the inbound weave puts at most one ask into a
// reply, ever. Two asks in one message reads as a sales pitch, not support.
export async function findDueAsk(
  sb: SupabaseClient,
  waId: string | null,
  nowIso: string,
): Promise<DueAsk | null> {
  if (!waId) return null;

  // UNSUBSCRIBED customers get no ask woven into their reply, ever. Every
  // journey in WINDOW_DELIVER_JOURNEYS is a MARKETING template, and an open 24h
  // window makes a message cap-immune, not consented. The customer still gets a
  // full, helpful support answer - they simply do not get a review ask or a
  // cart nudge riding along with it.
  //
  // Fails OPEN on a query error (treat as subscribed) to match the rest of this
  // module: a lookup blip must never silently stop asks for everyone. A genuine
  // opt-out is still caught by wa-journey-tick, which cancels the run outright.
  const { data: c, error: cErr } = await sb
    .from("wa_contacts")
    .select("opted_in")
    .eq("wa_id", waId)
    .maybeSingle();
  if (!cErr && c && c.opted_in === false) return null;

  const { data } = await sb
    .from("wa_journey_runs")
    .select("id, journey_key, order_ref, context, deadline_at, delivered_at")
    .eq("wa_id", waId)
    .eq("status", "active")
    .in("journey_key", WINDOW_DELIVER_JOURNEYS as unknown as string[])
    .lte("next_action_at", nowIso)
    .order("next_action_at", { ascending: true });
  if (!data?.length) return null;

  // Compare deadlines as epoch millis, never as strings: PostgREST returns
  // "…+00:00" while new Date().toISOString() returns "…Z", and those two do not
  // sort lexicographically against each other at equal instants.
  const nowMs = Date.parse(nowIso);
  const eligible = data.filter((r) => {
    // delivered_at is the terminal flag on the cart's at-least-once guarantee.
    // A run carrying it has already landed with the customer — never again.
    if (r.delivered_at) return false;
    // Past its own deadline (carts get 72h). Delivering a two-day-old cart
    // nudge is worse than delivering nothing; the tick will expire the run.
    const deadlineMs = r.deadline_at ? Date.parse(String(r.deadline_at)) : NaN;
    if (Number.isFinite(deadlineMs) && Number.isFinite(nowMs) && deadlineMs < nowMs) return false;
    // A cart recovery IS its checkout link. A run with no link (enrolled before
    // we stored one) must fall through to the template — which still carries
    // the dynamic recovery button — rather than be woven as a linkless nudge
    // that tells the customer their cart is waiting and then strands them.
    const url = String(runVars(r.context)["2"] ?? "").trim();
    if (r.journey_key === "abandoned_checkout" && !url) return false;
    return true;
  });
  if (!eligible.length) return null;

  // Stable sort: ties (same priority) keep the next_action_at ordering above,
  // so the oldest due run of the winning kind is the one delivered.
  eligible.sort((a, b) => (ASK_PRIORITY[a.journey_key] ?? 9) - (ASK_PRIORITY[b.journey_key] ?? 9));
  const pick = eligible[0];
  const vars = runVars(pick.context);
  return {
    runId: pick.id,
    journeyKey: pick.journey_key,
    orderRef: pick.order_ref ?? null,
    url: vars["2"] ?? "",
    name: vars["1"] ?? "",
  };
}

// Atomic claim: active -> completed, returning whether THIS caller won. Single
// UPDATE statement, so concurrent callers (a tick + an inbound reply firing in
// the same instant) are serialised by Postgres — one wins, the rest see no row.
export async function claimAsk(sb: SupabaseClient, runId: string): Promise<boolean> {
  const { data } = await sb
    .from("wa_journey_runs")
    .update({ status: "completed", last_error: "delivered in 24h service window" })
    .eq("id", runId)
    .eq("status", "active")
    .select("id");
  return !!(data && data.length);
}

// Hand a claim back after a FAILED in-window send (or when the bot decided NOT
// to ask because the conversation mood was wrong), so the ask is retried by a
// later tick / next session rather than silently dropped.
export async function releaseAsk(sb: SupabaseClient, runId: string): Promise<void> {
  await sb
    .from("wa_journey_runs")
    .update({ status: "active", last_error: "in-window ask not delivered; will retry" })
    .eq("id", runId)
    .eq("status", "completed")
    .then(() => {}, () => {});
}

// Stamp the TERMINAL delivered flag after a CONFIRMED in-window delivery.
//
// claimAsk() alone leaves the run 'completed' with delivered_at null, which is
// the state wa-webhook's async-failure handler is allowed to reopen for the
// cart's at-least-once guarantee. That reopen only fires for a template send
// (sent_by 'journey:abandoned_checkout'), so it cannot currently resurrect a
// free-text delivery — but relying on that is one refactor away from messaging
// a customer twice. Stamping delivered_at closes the door for good: every
// reopen path is guarded on `delivered_at is null`.
export async function markAskDelivered(sb: SupabaseClient, runId: string): Promise<void> {
  await sb
    .from("wa_journey_runs")
    .update({ delivered_at: new Date().toISOString() })
    .eq("id", runId)
    .is("delivered_at", null)
    .then(() => {}, () => {});
}

// ---- measurement --------------------------------------------------------
// The whole point of the window-manufacturing work is to shift asks off the
// 84%-blocked marketing-template path onto the ~99%-delivered free-text path.
// That shift has to be countable from production data WITHOUT new DB columns,
// so every ask delivery emits one connector_event carrying the two dimensions
// that matter: HOW it was delivered (free_text vs template) and WHICH path
// triggered it (an inbound message, a button tap, or the cron tick).
//
//   select detail->>'mode', detail->>'path', count(*)
//   from connector_events
//   where connector = 'whatsapp' and event = 'ask_delivered'
//   group by 1, 2;
export type AskDeliveryMode = "free_text" | "template";
export type AskDeliveryPath = "inbound_weave" | "tick_window" | "template_tick";

export function logAskDelivery(input: {
  journeyKey: string;
  mode: AskDeliveryMode;
  path: AskDeliveryPath;
  runId: string;
  waId?: string | null;
  orderRef?: string | null;
}): Promise<void> {
  return logConnector({
    connector: "whatsapp",
    level: "info",
    event: "ask_delivered",
    message: `${input.journeyKey} delivered as ${input.mode} via ${input.path}.`,
    detail: {
      journey_key: input.journeyKey,
      mode: input.mode,
      path: input.path,
      run_id: input.runId,
      wa_id: input.waId ?? null,
    },
    ref: input.orderRef ?? null,
  }).catch(() => {});
}

// First usable name from a "Full Name" string or fallback hint.
export function firstNameOf(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (t && !/^there$/i.test(t)) return t.split(/\s+/)[0];
  }
  return "there";
}
