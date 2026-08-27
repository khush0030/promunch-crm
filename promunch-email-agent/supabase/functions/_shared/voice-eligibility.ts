// Pure decision logic for the Sarvam voice rescue call. No I/O, so it is unit
// tested in isolation; wa-journey-tick gathers the inputs and acts on the verdict.
//
// Ordering matters: the "cancel" checks are cheap and final, the "defer" checks
// leave the run alive.
//
// RETRY RULE (why cartConnected / cartAttempts / cartInFlight exist instead of
// one boolean "already called this cart"): a single voice_calls row per cart
// used to block any further dial the instant it existed, in ANY non-terminal
// state. That made the two retry paths that reference this cart dead code —
// voice-webhook's one-retry-after-no_answer/busy, and wa-journey-tick's
// 3-strike start-failure retry — because the very next tick would see the
// interim row and cancel the run as "already_called_this_cart" before the
// retry could fire, mislabelling "we dialled once and got no answer" as "we
// reached them". The fix distinguishes three things instead of one:
//   - cartConnected: a call for this cart actually reached the customer.
//     Terminal. Nothing about a connected call is retryable.
//   - cartAttempts: how many REAL dial attempts (Sarvam actually placed the
//     call — connected/no_answer/busy/failed, or an 'unknown' row that has an
//     attempt_id) have happened for this cart, ever. Capped at
//     CART_ATTEMPT_CAP (2): one original dial + one retry, then stop bothering
//     this customer about this cart. Infra-only failures — 'start_failed', or
//     a 'dialing'/'unknown' row with no attempt_id (Sarvam was never actually
//     reached, e.g. the fetch to voice-call-start itself failed) — do NOT
//     consume this budget; the customer's phone never rang, so it isn't a
//     dial attempt against them, and those retries are already bounded
//     independently by wa-journey-tick's own voice_start_failures strike
//     counter (3 strikes then terminal).
//   - cartInFlight: a dial for this cart is currently unresolved ('dialing').
//     This must still block a second concurrent dial, but only defers — it is
//     a transient state, not a verdict, so cancelling it would burn the retry
//     for nothing.
// Per-customer fatigue (connectedWithin7d) is keyed on an actual CONNECTION
// within 7 days, not merely an attempt — a string of no-answers on other carts
// should not silence a rescue call for a new, unrelated cart.

export const VOICE_TEMPLATE = "voice_cart_call";

const IST_OFFSET_MS = 5.5 * 3600_000;

export function istHour(nowMs: number): number {
  return new Date(nowMs + IST_OFFSET_MS).getUTCHours();
}

export function inCallWindow(nowMs: number, startHour: number, endHour: number): boolean {
  const h = istHour(nowMs);
  return h >= startHour && h < endHour;
}

/** Next IST `startHour` strictly after `nowMs`, as a UTC Date. */
export function nextWindowOpen(nowMs: number, startHour: number): Date {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  let openIst = day + startHour * 3600_000;
  if (openIst <= nowMs + IST_OFFSET_MS) openIst += 86400_000;
  return new Date(openIst - IST_OFFSET_MS);
}

// Lifetime cap on real dial attempts per cart: one original dial + one retry.
export const CART_ATTEMPT_CAP = 2;

export interface VoiceEligibilityInput {
  enabled: boolean;
  cartTotal: number;
  minCartValue: number;
  voiceDnd: boolean;
  optedIn: boolean;
  inboundSinceEnrol: boolean;
  waDelivered: boolean;
  waStoodDown: boolean;
  waPending: boolean;
  /** A call for this cart reached the customer (status='connected'). Terminal. */
  cartConnected: boolean;
  /** Count of REAL dial attempts for this cart, ever (see module comment). */
  cartAttempts: number;
  /** A dial for this cart is currently unresolved ('dialing'). Defers, not cancels. */
  cartInFlight: boolean;
  /** Any cart for this customer connected within the last 7 days. */
  connectedWithin7d: boolean;
}

export type VoiceVerdict =
  | { action: "call" }
  | { action: "cancel"; reason: string }
  | { action: "defer"; hours: number; reason: string };

export function voiceEligibility(i: VoiceEligibilityInput): VoiceVerdict {
  if (!i.enabled) return { action: "defer", hours: 6, reason: "voice_disabled" };
  if (i.cartConnected) return { action: "cancel", reason: "cart_already_connected" };
  if (i.connectedWithin7d) return { action: "cancel", reason: "connected_within_7d" };
  if (i.cartAttempts >= CART_ATTEMPT_CAP) return { action: "cancel", reason: "cart_attempt_cap_reached" };
  if (i.cartInFlight) return { action: "defer", hours: 1, reason: "call_in_flight" };
  if (i.voiceDnd) return { action: "cancel", reason: "voice_dnd" };
  if (!i.optedIn) return { action: "cancel", reason: "wa_opted_out" };
  if (i.inboundSinceEnrol) return { action: "cancel", reason: "wa_engaged" };
  if (i.cartTotal < i.minCartValue) return { action: "cancel", reason: "below_min_cart_value" };
  if (i.waPending && !i.waStoodDown) return { action: "defer", hours: 1, reason: "wa_pending" };
  return { action: "call" };
}
