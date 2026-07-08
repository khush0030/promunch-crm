// Translate raw Meta WhatsApp send errors into plain English for staff.
// Mirrors the classification in supabase/functions/_shared/connector-log.ts
// (explainWaError there is Deno-side; this is the dashboard copy).
// Codes: docs/whatsapp/META_WHATSAPP_TEMPLATE_RULES.md §4.

const RULES: { re: RegExp; msg: string }[] = [
  {
    re: /131049|healthy ecosystem/i,
    msg: "Meta's per-person marketing limit — this contact got too many promos recently. Not a fault; the engine retries them on a later day.",
  },
  {
    re: /131050/,
    msg: "This contact opted out of our marketing messages on WhatsApp.",
  },
  {
    re: /132012|format mismatch|Parameter format does not match/i,
    msg: "Message didn't match the approved template's shape — usually a missing or extra media header. Check the template's header media, then re-sync from Meta.",
  },
  {
    re: /132000|number of parameters/i,
    msg: "Wrong number of variable values for this template — fill every {{n}} variable before sending.",
  },
  {
    re: /132001|template name does not exist/i,
    msg: "Template isn't approved at Meta under this name/language. Sync templates and pick an approved one.",
  },
  {
    re: /131047|re-?engagement message/i,
    msg: "Outside the 24-hour customer window — only an approved template can reach this person until they message us again.",
  },
  {
    re: /131026/,
    msg: "Recipient can't receive this — the number may not be on WhatsApp.",
  },
  {
    re: /131048/,
    msg: "Meta paused our sends (spam-rate limit). Slow down and check the number's quality rating in WhatsApp Manager.",
  },
  {
    re: /131056/,
    msg: "Too many messages to this same person in a short burst — wait before retrying.",
  },
  {
    re: /131031|account has been locked/i,
    msg: "Our WhatsApp business account is locked or restricted — check WhatsApp Manager immediately.",
  },
  {
    re: /OAuthException|access token|Error validating access token|\(#190\)|code.{0,3}190/i,
    msg: "WhatsApp access token expired — rotate the system-user token (see SECURITY_RUNBOOK).",
  },
  {
    re: /80007|rate limit/i,
    msg: "Hit Meta's API rate limit — the engine backs off and retries automatically.",
  },
  {
    re: /131042|payment/i,
    msg: "Billing problem on the WhatsApp account — check the payment method in Meta Business settings.",
  },
  {
    re: /temporarily blocked|\(#368\)/i,
    msg: "Our number is temporarily blocked by Meta for policy reasons — check WhatsApp Manager.",
  },
];

/** Friendly one-liner for a raw Meta error, or null when unrecognised. */
export function explainWaError(err: string | null | undefined): string | null {
  if (!err) return null;
  for (const r of RULES) if (r.re.test(err)) return r.msg;
  return null;
}
