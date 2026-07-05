// IST send-window and follow-up scheduling math for B2B sequences.
// All recipients are Indian businesses, so the day boundary and the send
// window both live in IST (UTC+5:30) regardless of server timezone.

const IST_OFFSET_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;

/** UTC instant of the current IST midnight (same math the send cap uses). */
export function istMidnightUtc(now: Date): Date {
  const istMs = now.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(istMs / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/** Hours (fractional) elapsed since IST midnight. */
function istHour(now: Date): number {
  const istMs = now.getTime() + IST_OFFSET_MS;
  return (istMs % DAY_MS) / 3600_000;
}

/** Inside the [startHour, endHour) IST window? */
export function inSendWindow(now: Date, startHour: number, endHour: number): boolean {
  const h = istHour(now);
  return h >= startHour && h < endHour;
}

/**
 * When the next step should go out: now + waitDays, clamped forward to the
 * next window start if it lands outside [startHour, endHour) IST.
 */
export function nextSendAt(now: Date, waitDays: number, startHour: number, endHour: number): Date {
  const target = new Date(now.getTime() + waitDays * DAY_MS);
  if (inSendWindow(target, startHour, endHour)) return target;
  const midnight = istMidnightUtc(target);
  const windowStart = new Date(midnight.getTime() + startHour * 3600_000);
  // Before today's window -> today's start; after it -> tomorrow's start.
  return target < windowStart ? windowStart : new Date(windowStart.getTime() + DAY_MS);
}
