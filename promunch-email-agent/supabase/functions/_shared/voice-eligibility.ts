// Pure decision logic for the Sarvam voice rescue call. No I/O, so it is unit
// tested in isolation; wa-journey-tick gathers the inputs and acts on the verdict.
//
// Ordering matters: the "cancel" checks are cheap and final, the "defer" checks
// leave the run alive. A voice row is only ever dialled ONCE per cart and at
// most once per customer per 7 days, regardless of what the caller passes.

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
  recentCallWithin7d: boolean;
  callForThisCart: boolean;
}

export type VoiceVerdict =
  | { action: "call" }
  | { action: "cancel"; reason: string }
  | { action: "defer"; hours: number; reason: string };

export function voiceEligibility(i: VoiceEligibilityInput): VoiceVerdict {
  if (!i.enabled) return { action: "defer", hours: 6, reason: "voice_disabled" };
  if (i.callForThisCart) return { action: "cancel", reason: "already_called_this_cart" };
  if (i.recentCallWithin7d) return { action: "cancel", reason: "called_within_7d" };
  if (i.voiceDnd) return { action: "cancel", reason: "voice_dnd" };
  if (!i.optedIn) return { action: "cancel", reason: "wa_opted_out" };
  if (i.inboundSinceEnrol) return { action: "cancel", reason: "wa_engaged" };
  if (i.cartTotal < i.minCartValue) return { action: "cancel", reason: "below_min_cart_value" };
  if (i.waPending && !i.waStoodDown) return { action: "defer", hours: 1, reason: "wa_pending" };
  return { action: "call" };
}
