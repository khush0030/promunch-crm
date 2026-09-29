// Opt-out / opt-in keyword detection for inbound WhatsApp messages.
//
// AGENTS.md §4.3: a bare STOP is an UNSUBSCRIBE. It never reaches the AI and
// never triggers a cancel flow. Marketing templates carry a "Stop promotions"
// quick-reply button; tapping it arrives as a BUTTON (template quick reply) or
// INTERACTIVE button_reply message, not as text, so it used to fall through to
// the AI. isStopTap() makes the tap exactly equivalent to typing STOP.
//
// Deliberately EXACT (case-insensitive, trimmed): "stop promotions" or "stop".
// A tap on anything else (COD Confirm/Cancel, service quick replies) is never
// read as an opt-out.

const STOP_TEXT_RE = /^\s*(stop|unsubscribe|stop promotions?|opt[\s-]?out)\s*$/i;
const START_TEXT_RE = /^\s*(start|unstop|subscribe|opt[\s-]?in)\s*$/i;
const STOP_TAP_VALUES = new Set(["stop promotions", "stop"]);

export function isStopText(body: string | null | undefined): boolean {
  return STOP_TEXT_RE.test(String(body ?? ""));
}

export function isStartText(body: string | null | undefined): boolean {
  return START_TEXT_RE.test(String(body ?? ""));
}

function norm(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

// deno-lint-ignore no-explicit-any
export function isStopTap(msg: any): boolean {
  if (!msg || typeof msg !== "object") return false;
  if (msg.type === "button") {
    return STOP_TAP_VALUES.has(norm(msg.button?.text)) || STOP_TAP_VALUES.has(norm(msg.button?.payload));
  }
  if (msg.type === "interactive") {
    const br = msg.interactive?.button_reply;
    return STOP_TAP_VALUES.has(norm(br?.title)) || STOP_TAP_VALUES.has(norm(br?.id));
  }
  return false;
}
