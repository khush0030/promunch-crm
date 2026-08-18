// The single source of truth for wa_messages.type on the code side.
//
// This list MUST stay identical to the wa_messages_type_check constraint
// (migration 20260818200000). When they drifted, every template quick-reply tap
// — the COD gate's Confirm/Cancel — failed its insert and wa-webhook dropped the
// entire inbound turn before the gate handler ran: 92 lost taps across 60 orders
// between 2026-07-25 and 2026-08-18. wa-message-types_test.ts diffs this array
// against the migration file so the two can never drift again.
export const WA_MESSAGE_TYPES = [
  "text",
  "template",
  "image",
  "document",
  "audio",
  "video",
  "interactive",
  "reaction",
  "system",
  "button",
  "order",
  "sticker",
  "location",
  "contacts",
  "unsupported",
  "unknown",
] as const;

const ALLOWED = new Set<string>(WA_MESSAGE_TYPES);

// Meta keeps adding inbound message types. Anything we do not know about is
// stored as 'unsupported' so an unknown type can never fail the insert and cost
// us a customer's message.
export function safeMessageType(t: string): string {
  return ALLOWED.has(t) ? t : "unsupported";
}
