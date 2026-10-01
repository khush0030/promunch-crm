// Pure decision logic for the Sarvam voice rescue call. No I/O, so it is unit
// tested in isolation; wa-journey-tick gathers the inputs and acts on the verdict.

export const VOICE_TEMPLATE = "voice_cart_call";

// A connected call counts as "reached" at this many seconds (or if the link
// went out mid-call). Lives here, in the pure module, so WhatsApp-side code can
// use it without importing the outcome handler's I/O dependencies.
export const REACHED_MIN_SECONDS = 20;

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

// CART (call-first, 2026-10-01 design): one call ~15 minutes after the cart goes
// quiet. Every "no" is a CANCEL, never a defer: a cart call that slips hours is
// a creepy call, and the WhatsApp + email sequence still covers the cart. The
// only defer is a dial already in flight for this cart.
export interface CartVoiceInput {
  enabled: boolean;
  inWindow: boolean;
  cartTotal: number;
  minCartValue: number;
  voiceDnd: boolean;
  optedIn: boolean;
  inboundSinceEnrol: boolean;
  openTicket: boolean;
  allowlisted: boolean;
  /** A real dial (Sarvam accepted it) already exists for this cart. */
  cartDialled: boolean;
  /** A dial for this cart is still 'dialing'. */
  cartInFlight: boolean;
  /** Any cart call for this customer CONNECTED in the last 7 days. */
  connectedWithin7d: boolean;
  /** A WhatsApp cart message for this sequence was already sent or attempted. */
  waAlreadySent: boolean;
}

export type VoiceVerdict =
  | { action: "call" }
  | { action: "cancel"; reason: string }
  | { action: "defer"; minutes: number; reason: string };

export function cartVoiceEligibility(i: CartVoiceInput): VoiceVerdict {
  const cancel = (reason: string): VoiceVerdict => ({ action: "cancel", reason });
  if (!i.enabled) return cancel("voice_disabled");
  if (i.cartInFlight) return { action: "defer", minutes: 15, reason: "call_in_flight" };
  if (i.cartDialled) return cancel("cart_already_called");
  if (i.waAlreadySent) return cancel("wa_already_sent");
  if (i.connectedWithin7d) return cancel("connected_within_7d");
  if (i.voiceDnd) return cancel("voice_dnd");
  if (!i.optedIn) return cancel("wa_opted_out");
  if (i.inboundSinceEnrol) return cancel("wa_engaged");
  if (i.openTicket) return cancel("open_ticket");
  if (i.cartTotal < i.minCartValue) return cancel("below_min_cart_value");
  if (!i.allowlisted) return cancel("not_in_test_allowlist");
  if (!i.inWindow) return cancel("outside_call_window");
  return { action: "call" };
}

// COD: there is no run row to cancel, so a "no" is a SKIP for this tick; the
// order stays pending and the 24h needs_call sweep (wa-jobs-tick) still covers
// it. Marketing opt-out is deliberately NOT a guard: confirming an order the
// customer placed is transactional. voice_dnd (they said "don't call me") is.
export interface CodVoiceInput {
  enabled: boolean;
  inWindow: boolean;
  status: string | null;
  voiceDnd: boolean;
  allowlisted: boolean;
  attempts: number;
  maxAttempts: number;
  lastCallStatus: string | null;
  lastCallAtMs: number | null;
  nowMs: number;
  retryHours: number;
}

export type CodVerdict = { action: "call" } | { action: "skip"; reason: string };

export function codVoiceEligibility(i: CodVoiceInput): CodVerdict {
  const skip = (reason: string): CodVerdict => ({ action: "skip", reason });
  if (!i.enabled) return skip("cod_voice_disabled");
  if (i.status !== "pending") return skip("not_pending");
  if (i.voiceDnd) return skip("voice_dnd");
  if (!i.allowlisted) return skip("not_in_test_allowlist");
  if (i.attempts >= i.maxAttempts) return skip("attempt_cap_reached");
  if (i.lastCallStatus === "dialing") return skip("call_in_flight");
  if (i.lastCallAtMs !== null && i.nowMs - i.lastCallAtMs < i.retryHours * 3600_000) return skip("retry_spacing");
  if (!i.inWindow) return skip("outside_call_window");
  return { action: "call" };
}

/** Orders whose confirmation_sent_at is before this are due their first COD call. */
export function codCallDueBefore(nowMs: number, reminderHours: number, voiceDelayHours: number): string {
  return new Date(nowMs - (reminderHours + voiceDelayHours) * 3600_000).toISOString();
}
