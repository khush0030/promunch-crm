// 24-hour customer-service-window delivery for post-purchase asks.
//
// WHY: review_request and replenishment_reminder are MARKETING templates, so
// Meta throttles them per-recipient (error 131049 — "healthy ecosystem
// engagement"). But when a customer has messaged us in the last 24h, that
// service window is OPEN and we may send FREE-FORM text instead of a template —
// no marketing cap, no template fee, and the copy can be richly personalized
// with the customer's name and the actual products they bought.
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

// Only these post-purchase asks are personalized + window-eligible. Abandoned-
// cart stays on its template (it carries a dynamic recovery-checkout button)
// for the INBOUND weave; abandoned_checkout is handled by the dedicated tick
// delivery path (WINDOW_DELIVER_JOURNEYS) so it never gets mislabeled as a
// post-purchase ask in a support reply.
export const WINDOW_ASK_JOURNEYS = ["review_request", "replenishment_reminder"] as const;

// Journeys whose DUE run wa-journey-tick may deliver as cap-immune free text
// when the 24h service window is open. Superset of WINDOW_ASK_JOURNEYS:
// abandoned_checkout's recovery is delivered free-form (no #131049 cap) whenever
// the customer has an open window, falling back to the capped template otherwise.
export const WINDOW_DELIVER_JOURNEYS = [
  "review_request",
  "replenishment_reminder",
  "abandoned_checkout",
] as const;

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
  url: string;   // review/site link, from context.vars["2"]
  name: string;  // first-name hint, from context.vars["1"]
}

// The single best in-window ask that is DUE for this customer. Prefer a review
// request over a restock nudge when both are due — never deliver two in one go.
export async function findDueAsk(
  sb: SupabaseClient,
  waId: string | null,
  nowIso: string,
): Promise<DueAsk | null> {
  if (!waId) return null;
  const { data } = await sb
    .from("wa_journey_runs")
    .select("id, journey_key, order_ref, context")
    .eq("wa_id", waId)
    .eq("status", "active")
    .in("journey_key", WINDOW_ASK_JOURNEYS as unknown as string[])
    .lte("next_action_at", nowIso)
    .order("next_action_at", { ascending: true });
  if (!data?.length) return null;

  const pick = data.find((r) => r.journey_key === "review_request") ?? data[0];
  const vars = (pick.context?.vars ?? {}) as Record<string, string>;
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

// First usable name from a "Full Name" string or fallback hint.
export function firstNameOf(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (t && !/^there$/i.test(t)) return t.split(/\s+/)[0];
  }
  return "there";
}
