// Plain-English explanations for WhatsApp TEMPLATE problems: Meta's review
// rejection reasons, and the errors Meta's template API returns when we
// submit, edit or delete a template. Staff never see a raw Meta code unless
// they open the collapsed "details".
//
// Only codes we are reasonably sure about are mapped. Anything unknown falls
// back to a generic, still-helpful message with the raw text kept for details.
// Message-text patterns are matched as well as numeric codes, because Meta's
// wording is more stable than its subcodes.

export type TemplateProblem = {
  title: string;
  explanation: string;
  howToFix: string;
  /** Raw Meta text for a collapsed "details" section; null when there is none. */
  raw: string | null;
  /** True when we recognised the code or message. */
  known: boolean;
};

type Entry = Omit<TemplateProblem, "raw" | "known">;

/* ------------------------------------------------------------------------ */
/* Review rejection reasons (wa_templates.rejection_reason)                   */
/* ------------------------------------------------------------------------ */

export const REJECTION_REASONS: Record<string, Entry> = {
  INVALID_FORMAT: {
    title: "Formatting problem",
    explanation:
      "Meta found something wrong with how the template is put together. The usual causes are placeholders that are out of order or have gaps, a placeholder at the very start or end of the message, two placeholders side by side, too many placeholders for a short message, or emojis in the header, footer or buttons.",
    howToFix:
      "Open Edit & resubmit. The checklist next to the form flags these problems. Fix everything it lists, then submit again.",
  },
  TAG_CONTENT_MISMATCH: {
    title: "Category does not match the message",
    explanation:
      "The category you picked does not fit what the message says. Most often a Utility template (order or account updates) contains promotional wording like an offer or discount.",
    howToFix:
      "If the message promotes something, resubmit it as Marketing. If it is really an order or account update, remove the promotional wording and resubmit as Utility.",
  },
  INCORRECT_CATEGORY: {
    title: "Wrong category",
    explanation: "Meta decided this template belongs in a different category from the one you chose.",
    howToFix: "Resubmit it under the other category (Marketing for promotions, Utility for order and account updates).",
  },
  PROMOTIONAL: {
    title: "Promotional content in a Utility template",
    explanation: "Utility templates can only carry order or account updates. Meta found promotional content in this one.",
    howToFix: "Resubmit it as Marketing, or remove the promotional wording.",
  },
  ABUSIVE_CONTENT: {
    title: "Content not allowed",
    explanation: "Meta's reviewer flagged the wording as breaking WhatsApp's commerce or business policy.",
    howToFix:
      "Rewrite the message in a plain, friendly tone. Avoid pushy claims, health or medical promises, and anything that could read as threatening. Then submit it under a new version name.",
  },
  SCAM: {
    title: "Looks like a scam to Meta",
    explanation:
      "Meta thinks the message could mislead people. Common triggers are shortened links, links to a different website than ours, or too-good-to-be-true offers.",
    howToFix: "Use full links to promunch.in, keep offers specific and honest, and resubmit under a new version name.",
  },
  INVALID_URL: {
    title: "Link problem",
    explanation: "Meta could not accept one of the links. Link shorteners and links that redirect elsewhere are often refused.",
    howToFix: "Use a full https://promunch.in link and resubmit.",
  },
  NONE: {
    title: "Rejected without a reason",
    explanation: "Meta rejected the template but did not say why.",
    howToFix:
      "Check the checklist in Edit & resubmit, simplify the wording, and resubmit. If it keeps happening, submit it as a new version with slightly different text.",
  },
};

export function explainRejection(reason: string | null | undefined, detail?: string | null): TemplateProblem {
  const code = String(reason ?? "").trim().toUpperCase();
  const e = REJECTION_REASONS[code];
  const raw = [code || null, detail || null].filter(Boolean).join(": ") || null;
  if (e) return { ...e, raw, known: true };
  return {
    title: "Rejected by Meta",
    explanation: detail?.trim()
      ? `Meta said: ${detail.trim()}`
      : "Meta rejected this template. The reason code is shown in the details.",
    howToFix: "Open Edit & resubmit, fix anything the checklist lists, simplify the wording and submit again.",
    raw,
    known: false,
  };
}

/* ------------------------------------------------------------------------ */
/* API errors (create / edit / delete)                                        */
/* ------------------------------------------------------------------------ */

export type MetaErrorShape = {
  code?: number | string | null;
  error_subcode?: number | string | null;
  subcode?: number | string | null;
  message?: string | null;
  error_user_title?: string | null;
  error_user_msg?: string | null;
  user_title?: string | null;
  user_msg?: string | null;
};

type ApiRule = { codes?: number[]; subcodes?: number[]; re?: RegExp } & Entry;

// Order matters: first match wins. Subcode/message rules come before the broad
// numeric codes (100 is Meta's catch-all "invalid parameter").
const API_RULES: ApiRule[] = [
  {
    subcodes: [2388024],
    re: /already exists|same name|content in this language already/i,
    title: "That name is already taken",
    explanation: "A template with this name and language already exists at Meta, so a new one cannot be created with it.",
    howToFix: "Use Edit & resubmit on the existing template, or use Duplicate as new version to get a fresh name like _v2.",
  },
  {
    subcodes: [2388023],
    re: /being deleted|was deleted|pending deletion|deleted.*(4|four) weeks|can't be used.*deleted/i,
    title: "That name was deleted recently",
    explanation: "Meta does not let you reuse a deleted template's name for about 30 days.",
    howToFix: "Pick a different name, for example add _v2 to the end.",
  },
  {
    re: /edit.*(limit|once|24 hours|per day)|number of edits|can(not|'t) be edited/i,
    title: "Edit limit reached",
    explanation:
      "Meta limits edits to an approved template: about once every 24 hours and 10 times in 30 days.",
    howToFix: "Wait a day and try again, or use Duplicate as new version to submit the change under a new name.",
  },
  {
    re: /category.*(can(not|'t)|not allowed|unable).*(change|edit)|change.*category/i,
    title: "Category cannot change",
    explanation: "Once a template is approved, Meta does not allow its category to be changed.",
    howToFix: "Keep the original category, or use Duplicate as new version to submit it under the new category.",
  },
  {
    subcodes: [2388293],
    re: /too many (variables|parameters)|ratio/i,
    title: "Too many placeholders",
    explanation: "Meta thinks the message has too many placeholders for its length.",
    howToFix: "Add more fixed words around the placeholders, or use fewer of them.",
  },
  {
    subcodes: [2388299],
    re: /(start|end|beginning|leading|trailing).{0,40}(variable|parameter)|(variable|parameter).{0,40}(start|end|beginning|leading|trailing)/i,
    title: "Placeholder at the start or end",
    explanation: "A message cannot begin or end with a placeholder like {{1}}.",
    howToFix: 'Add a few words before and after, for example "Hi {{1}}, ..." and end with a normal sentence.',
  },
  {
    re: /(variable|parameter).{0,40}(format|sequential|order|number)|invalid parameter format|curly/i,
    title: "Placeholder numbering problem",
    explanation: "The placeholders must be written {{1}}, {{2}}, {{3}} in order, with no gaps and nothing else inside the brackets.",
    howToFix: "Renumber the placeholders and make sure every one has an example value.",
  },
  {
    re: /example|sample/i,
    title: "Example values missing",
    explanation: "Meta needs an example value for every placeholder (and an example link for personalised link buttons).",
    howToFix: "Fill in every example field in the form and submit again.",
  },
  {
    re: /emoji|newline|new line|line break/i,
    title: "Emoji or line break where it is not allowed",
    explanation: "Headers, footers and button labels cannot contain emojis, and headers and footers cannot contain line breaks.",
    howToFix: "Remove emojis and line breaks from the header, footer and buttons. Emojis are fine in the message body.",
  },
  {
    re: /(too long|exceed|character limit|maximum length|max(imum)? of \d+ characters)/i,
    title: "Text too long",
    explanation: "One part of the template is over Meta's length limit (message 1024, header 60, footer 60, button label 25 characters).",
    howToFix: "Shorten the part the checklist highlights and submit again.",
  },
  {
    re: /header.*(media|handle|image|video|document)|(media|handle).*header|upload/i,
    title: "Header file problem",
    explanation: "Meta could not use the header image, video or PDF.",
    howToFix: "Upload the file again (JPG or PNG up to 5 MB, MP4 up to 16 MB, PDF up to 100 MB) and resubmit.",
  },
  {
    re: /button/i,
    title: "Button problem",
    explanation: "Meta did not accept one of the buttons.",
    howToFix: "Check each button: labels up to 25 characters with no emoji, links starting with https://, a personalised link only with {{1}} at the end, phone numbers starting with + and the country code.",
  },
  {
    re: /language/i,
    title: "Language problem",
    explanation: "Meta did not accept the language for this template.",
    howToFix: "Pick the language from the list in the form.",
  },
  {
    codes: [368],
    re: /temporarily blocked|policy violation/i,
    title: "Account temporarily blocked",
    explanation: "Meta has temporarily blocked our WhatsApp account from this action for a policy reason.",
    howToFix: "Do not retry for now. Tell the owner so they can check WhatsApp Manager for a policy notice.",
  },
  {
    codes: [190],
    re: /access token|session has expired|OAuthException/i,
    title: "WhatsApp connection expired",
    explanation: "The access token the dashboard uses to talk to Meta has expired or been revoked.",
    howToFix: "Tell the owner: the WhatsApp system-user token needs to be rotated in Meta Business settings.",
  },
  {
    codes: [200, 10],
    re: /permission/i,
    title: "Missing permission",
    explanation: "Our Meta connection does not have permission to manage templates.",
    howToFix: "Tell the owner: the system user needs the whatsapp_business_management permission.",
  },
  {
    codes: [4, 80008, 80007],
    re: /rate limit|too many (calls|requests)|limit reached for/i,
    title: "Too many requests",
    explanation: "Meta limits how many templates can be created or edited in a short time.",
    howToFix: "Wait an hour and try again.",
  },
  {
    codes: [100],
    title: "Meta did not accept one of the values",
    explanation: "Meta said one of the fields in the template is not valid.",
    howToFix: "Check the checklist in the form, fix anything it lists, and try again. The details below show exactly what Meta said.",
  },
];

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? n : null;
}

// Pull the numeric code/subcode out of a flattened error string such as
// "Invalid parameter | ... | subcode 2388024" or "(#100) ...".
function parseCodes(s: string): { code: number | null; subcode: number | null } {
  const sub = s.match(/subcode[^\d]{0,3}(\d{3,})/i);
  const code = s.match(/\(#(\d+)\)/) ?? s.match(/\bcode[^\d]{0,3}(\d+)/i);
  return { code: code ? Number(code[1]) : null, subcode: sub ? Number(sub[1]) : null };
}

export function explainTemplateError(err: string | MetaErrorShape | null | undefined): TemplateProblem {
  let code: number | null = null;
  let subcode: number | null = null;
  let text = "";
  if (typeof err === "string") {
    text = err;
    ({ code, subcode } = parseCodes(err));
  } else if (err && typeof err === "object") {
    code = num(err.code);
    subcode = num(err.error_subcode ?? err.subcode);
    text = [err.message, err.error_user_title ?? err.user_title, err.error_user_msg ?? err.user_msg]
      .filter(Boolean)
      .join(" | ");
  }
  const raw = [text || null, code !== null ? `code ${code}` : null, subcode !== null ? `subcode ${subcode}` : null]
    .filter(Boolean)
    .join(" | ") || null;

  // Pass 1: exact subcode. Pass 2: message text. Pass 3: broad numeric code.
  for (const r of API_RULES) {
    if (subcode !== null && r.subcodes?.includes(subcode)) return { ...pick(r), raw, known: true };
  }
  for (const r of API_RULES) {
    if (r.re && text && r.re.test(text)) return { ...pick(r), raw, known: true };
  }
  for (const r of API_RULES) {
    if (code !== null && r.codes?.includes(code)) return { ...pick(r), raw, known: true };
  }
  return {
    title: "Meta did not accept this",
    explanation: "Something went wrong talking to Meta and we do not recognise the exact reason.",
    howToFix: "Check the checklist in the form, then try again. If it keeps failing, send the details below to the owner.",
    raw,
    known: false,
  };
}

function pick(r: ApiRule): Entry {
  return { title: r.title, explanation: r.explanation, howToFix: r.howToFix };
}
