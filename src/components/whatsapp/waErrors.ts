// Translate raw Meta WhatsApp send errors into plain English for staff.
// Mirrors the classification in supabase/functions/_shared/connector-log.ts
// (explainWaError there is Deno-side; this is the dashboard copy).
// Codes: docs/whatsapp/META_WHATSAPP_TEMPLATE_RULES.md §4.

export type WaErrorInfo = {
  /** stable grouping key for failure-breakdown UIs */
  key: string;
  /** short label ("Meta marketing frequency cap") */
  title: string;
  /** full plain-English explanation */
  msg: string;
  /** the campaign engine retries these contacts on a later day by itself */
  willRetry: boolean;
  /** what staff should do; null = nothing, this is normal */
  action: string | null;
};

const RULES: ({ re: RegExp } & WaErrorInfo)[] = [
  {
    re: /131049|healthy ecosystem/i,
    key: "cap",
    title: "Meta marketing frequency cap",
    willRetry: true,
    action: null,
    msg: "Meta's per-person marketing limit — this contact got too many promos recently. Not a fault; the engine retries them on a later day.",
  },
  {
    re: /130472|part of an experiment/i,
    key: "experiment",
    title: "Meta experiment holdout",
    willRetry: false,
    action: null,
    msg: "Meta withholds marketing messages from this person as part of its own experiments. Nothing on our side can change this.",
  },
  {
    re: /131050/,
    key: "optout",
    title: "Opted out of marketing",
    willRetry: false,
    action: null,
    msg: "This contact opted out of our marketing messages on WhatsApp.",
  },
  {
    re: /132012|format mismatch|Parameter format does not match/i,
    key: "template-format",
    title: "Template format mismatch",
    willRetry: false,
    action: "Check the template's header media, then re-sync from Meta (Templates tab).",
    msg: "Message didn't match the approved template's shape — usually a missing or extra media header. Check the template's header media, then re-sync from Meta.",
  },
  {
    re: /132000|number of parameters/i,
    key: "template-params",
    title: "Wrong variable count",
    willRetry: false,
    action: "Fill every {{n}} variable before sending.",
    msg: "Wrong number of variable values for this template — fill every {{n}} variable before sending.",
  },
  {
    re: /132001|template name does not exist/i,
    key: "template-missing",
    title: "Template not approved",
    willRetry: false,
    action: "Sync templates and pick an approved one.",
    msg: "Template isn't approved at Meta under this name/language. Sync templates and pick an approved one.",
  },
  {
    re: /131047|re-?engagement message/i,
    key: "window",
    title: "Outside the 24h window",
    willRetry: false,
    action: "Use an approved template to reach this person.",
    msg: "Outside the 24-hour customer window — only an approved template can reach this person until they message us again.",
  },
  {
    re: /131026|undeliverable/i,
    key: "not-on-whatsapp",
    title: "Not reachable on WhatsApp",
    willRetry: false,
    action: null,
    msg: "Recipient can't receive this — the number may not be on WhatsApp.",
  },
  {
    re: /131053|media upload error/i,
    key: "media",
    title: "Header media fetch failed",
    willRetry: false,
    action: "If only a few contacts hit this it was a transient Meta timeout. If most did, re-upload the template's header media.",
    msg: "Meta couldn't fetch the template's header image/video for this recipient — usually a transient timeout on Meta's side.",
  },
  {
    re: /131048/,
    key: "spam-pause",
    title: "Meta paused our sends",
    willRetry: false,
    action: "Slow down and check the number's quality rating in WhatsApp Manager.",
    msg: "Meta paused our sends (spam-rate limit). Slow down and check the number's quality rating in WhatsApp Manager.",
  },
  {
    re: /131056/,
    key: "burst",
    title: "Too many to one person",
    willRetry: false,
    action: "Wait before retrying this contact.",
    msg: "Too many messages to this same person in a short burst — wait before retrying.",
  },
  {
    re: /131031|account has been locked/i,
    key: "locked",
    title: "Business account locked",
    willRetry: false,
    action: "Check WhatsApp Manager immediately.",
    msg: "Our WhatsApp business account is locked or restricted — check WhatsApp Manager immediately.",
  },
  {
    re: /OAuthException|access token|Error validating access token|\(#190\)|code.{0,3}190/i,
    key: "token",
    title: "Access token expired",
    willRetry: false,
    action: "Rotate the system-user token (see SECURITY_RUNBOOK).",
    msg: "WhatsApp access token expired — rotate the system-user token (see SECURITY_RUNBOOK).",
  },
  {
    re: /80007|rate limit/i,
    key: "rate",
    title: "API rate limit",
    willRetry: true,
    action: null,
    msg: "Hit Meta's API rate limit — the engine backs off and retries automatically.",
  },
  {
    re: /131042|payment/i,
    key: "billing",
    title: "Billing problem",
    willRetry: false,
    action: "Check the payment method in Meta Business settings.",
    msg: "Billing problem on the WhatsApp account — check the payment method in Meta Business settings.",
  },
  {
    re: /temporarily blocked|\(#368\)/i,
    key: "blocked",
    title: "Number temporarily blocked",
    willRetry: false,
    action: "Check WhatsApp Manager.",
    msg: "Our number is temporarily blocked by Meta for policy reasons — check WhatsApp Manager.",
  },
  {
    re: /stale claim reclaimed/i,
    key: "interrupted",
    title: "Interrupted mid-send",
    willRetry: false,
    action: null,
    msg: "The sender restarted while this contact was in flight. Not retried automatically — we can't be sure the message didn't go out, and a duplicate is worse than a miss.",
  },
];

/** Friendly one-liner for a raw Meta error, or null when unrecognised. */
export function explainWaError(err: string | null | undefined): string | null {
  if (!err) return null;
  for (const r of RULES) if (r.re.test(err)) return r.msg;
  return null;
}

/** Full classification for grouping failures; always returns something. */
export function classifyWaError(err: string | null | undefined): WaErrorInfo {
  if (err) {
    for (const r of RULES) {
      if (r.re.test(err)) {
        return { key: r.key, title: r.title, msg: r.msg, willRetry: r.willRetry, action: r.action };
      }
    }
  }
  return {
    key: "unknown",
    title: "Unrecognised error",
    msg: err || "No error recorded.",
    willRetry: false,
    action: "Open Recipients to see Meta's raw reason.",
  };
}
