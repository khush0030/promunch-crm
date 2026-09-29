// WhatsApp template rules: the CORE checks shared by the dashboard and the
// wa-template-create edge function.
//
// TWIN FILES, keep them byte-identical:
//   src/lib/whatsapp/template-rules-core.ts                       (Next.js app)
//   promunch-email-agent/supabase/functions/_shared/template-rules.ts (Deno edge)
// Edge functions cannot import from src/, so the file is duplicated. A vitest
// in src/lib/whatsapp/template-rules.test.ts fails the build if they drift.
// Pure TypeScript, no imports, runs unchanged in Node and Deno.
//
// The dashboard-only extras (language list, media limits, warnings, copy
// helpers) live in src/lib/whatsapp/template-rules.ts on top of this file.

export const STOP_NOTICE = "Reply STOP to unsubscribe";
export const FOOTER_SEPARATOR = " · ";
export const FOOTER_MAX = 60;
export const BODY_MAX = 1024;
export const HEADER_TEXT_MAX = 60;
export const BUTTON_TEXT_MAX = 25;
export const MAX_BUTTONS = 10;
export const MAX_URL_BUTTONS = 2;
export const MAX_PHONE_BUTTONS = 1;
export const NAME_RE = /^[a-z0-9_]{1,512}$/;

export type CoreIssue = { field: string; message: string; fix?: string };

export type CoreButton = {
  type?: string;
  text?: string;
  url?: string;
  example?: string | string[];
  phone_number?: string;
};

export type CoreTemplate = {
  name?: string | null;
  category?: string | null;
  header_type?: string | null;
  header_text?: string | null;
  header_media_url?: string | null;
  body?: string | null;
  footer?: string | null;
  buttons?: CoreButton[] | null;
  body_samples?: string[] | null;
  header_samples?: string[] | null;
};

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const STOP_WORD_RE = /\bSTOP\b/;

export function hasEmoji(s: string | null | undefined): boolean {
  return EMOJI_RE.test(s ?? "");
}

// "marketing" and the CRM-only "offer" bucket are both MARKETING at Meta.
export function isMarketingCategory(category: string | null | undefined): boolean {
  const v = String(category ?? "").trim().toLowerCase();
  return v !== "utility" && v !== "authentication";
}

// The footer exactly as it will be sent to Meta. Marketing templates always
// carry the STOP notice (our opt-out flow keys on a bare "STOP"). The notice
// is detected only as the whole uppercase word STOP, so "non-stop" does not
// count. This never truncates: if the result is longer than FOOTER_MAX the
// template is invalid and the author must shorten their footer.
export function finalFooter(
  category: string | null | undefined,
  footer: string | null | undefined,
): string | null {
  const f = (footer ?? "").trim();
  if (!isMarketingCategory(category)) return f || null;
  if (!f) return STOP_NOTICE;
  if (STOP_WORD_RE.test(f)) return f;
  return `${f}${FOOTER_SEPARATOR}${STOP_NOTICE}`;
}

// Distinct {{n}} numbers used in a string, ascending.
export function varNumbers(s: string | null | undefined): number[] {
  const m = (s ?? "").match(/\{\{(\d+)\}\}/g) ?? [];
  return Array.from(new Set(m.map((x) => Number(x.replace(/[{}]/g, ""))))).sort((a, b) => a - b);
}

// Placeholder checks for one text field (body or header).
// `label` is the plain-English name of the field ("message", "header").
export function checkVariables(
  text: string,
  field: string,
  label: string,
  opts: { maxVars?: number } = {},
): CoreIssue[] {
  const issues: CoreIssue[] = [];

  // Anything in double braces that is not a plain number.
  const all = text.match(/\{\{[^{}]*\}\}/g) ?? [];
  for (const raw of all) {
    const inner = raw.slice(2, -2);
    if (/^\d+$/.test(inner)) continue;
    issues.push({
      field,
      message: `"${raw}" in the ${label} is not a valid placeholder.`,
      fix: /^\s*\d+\s*$/.test(inner)
        ? `Remove the spaces so it reads {{${inner.trim()}}}.`
        : "Placeholders must be numbers in double curly brackets, like {{1}}.",
    });
  }
  // Stray braces that do not form a {{...}} pair.
  const stripped = text.replace(/\{\{[^{}]*\}\}/g, "");
  if (/\{|\}/.test(stripped)) {
    issues.push({
      field,
      message: `The ${label} has a curly bracket that is not part of a placeholder.`,
      fix: "Placeholders need two brackets on each side, like {{1}}. Remove any single { or }.",
    });
  }

  const nums = varNumbers(text);
  if (nums.length === 0) return issues;

  if (opts.maxVars !== undefined && nums.length > opts.maxVars) {
    issues.push({
      field,
      message: `The ${label} can have at most ${opts.maxVars} placeholder${opts.maxVars === 1 ? "" : "s"}.`,
      fix: "Move the extra personalised values into the message body.",
    });
  }
  if (nums[0] === 0) {
    issues.push({ field, message: `Placeholders start at {{1}}, not {{0}}.`, fix: "Renumber them {{1}}, {{2}}, and so on." });
  }
  const missing: number[] = [];
  const max = nums[nums.length - 1];
  for (let i = 1; i <= max; i++) if (!nums.includes(i)) missing.push(i);
  if (missing.length) {
    issues.push({
      field,
      message: `Placeholders in the ${label} must be numbered in order with no gaps. Missing: ${missing.map((n) => `{{${n}}}`).join(", ")}.`,
      fix: `Renumber them so they go {{1}}, {{2}}, {{3}} without skipping.`,
    });
  }
  const trimmed = text.trim();
  if (/^\{\{\d+\}\}/.test(trimmed)) {
    issues.push({
      field,
      message: `The ${label} cannot start with a placeholder.`,
      fix: 'Add a word or two before it, for example "Hi {{1}}".',
    });
  }
  if (/\{\{\d+\}\}$/.test(trimmed)) {
    issues.push({
      field,
      message: `The ${label} cannot end with a placeholder.`,
      fix: "Add a few words after it, for example \"your order {{1}} is on its way.\"",
    });
  }
  if (/\}\}\s*\{\{/.test(text)) {
    issues.push({
      field,
      message: `Two placeholders in the ${label} sit right next to each other.`,
      fix: "Put at least one word between them.",
    });
  }
  return issues;
}

// Words that are not placeholders. Used for Meta's "too many variables for the
// length of the message" rule.
export function plainWordCount(text: string): number {
  return text.replace(/\{\{[^{}]*\}\}/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function checkButtons(buttons: CoreButton[]): CoreIssue[] {
  const issues: CoreIssue[] = [];
  if (buttons.length > MAX_BUTTONS) {
    issues.push({ field: "buttons", message: `A template can have at most ${MAX_BUTTONS} buttons.`, fix: "Remove some buttons." });
  }
  const types = buttons.map((b) => String(b.type ?? "").toUpperCase());
  const urlCount = types.filter((t) => t === "URL").length;
  const phoneCount = types.filter((t) => t === "PHONE_NUMBER").length;
  if (urlCount > MAX_URL_BUTTONS) {
    issues.push({ field: "buttons", message: `Only ${MAX_URL_BUTTONS} link buttons are allowed.`, fix: "Remove a link button." });
  }
  if (phoneCount > MAX_PHONE_BUTTONS) {
    issues.push({ field: "buttons", message: "Only 1 call button is allowed.", fix: "Remove the extra call button." });
  }
  // Quick replies must be grouped together, not mixed in between link/call buttons.
  const groups = types.map((t) => (t === "QUICK_REPLY" ? "Q" : "C")).join("").replace(/(.)\1+/g, "$1");
  if (groups.length > 2) {
    issues.push({
      field: "buttons",
      message: "Quick reply buttons must be next to each other, not mixed in between link or call buttons.",
      fix: "Reorder the buttons so all Quick reply buttons come first (or last).",
    });
  }
  const seen = new Set<string>();
  buttons.forEach((b, i) => {
    const f = `buttons.${i}`;
    const type = types[i];
    const text = String(b.text ?? "").trim();
    const n = i + 1;
    if (!["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(type)) {
      issues.push({ field: f, message: `Button ${n} has an unknown type.`, fix: "Remove it and add it again." });
      return;
    }
    if (!text) issues.push({ field: f, message: `Button ${n} needs a label.`, fix: 'For example "Shop now".' });
    if (text.length > BUTTON_TEXT_MAX) {
      issues.push({ field: f, message: `Button ${n} label is ${text.length} characters. The limit is ${BUTTON_TEXT_MAX}.`, fix: "Shorten the label." });
    }
    if (hasEmoji(text)) issues.push({ field: f, message: `Button ${n} label has an emoji. Meta rejects emojis in buttons.`, fix: "Remove the emoji." });
    if (/\{\{/.test(text)) issues.push({ field: f, message: `Button ${n} label cannot contain a placeholder.`, fix: "Use fixed text for the label." });
    if (text) {
      const key = text.toLowerCase();
      if (seen.has(key)) issues.push({ field: f, message: `Two buttons are both labelled "${text}".`, fix: "Give every button a different label." });
      seen.add(key);
    }
    if (type === "URL") {
      const url = String(b.url ?? "").trim();
      if (!url) {
        issues.push({ field: f, message: `Link button ${n} needs a web address.`, fix: "Paste the full link, starting with https://" });
        return;
      }
      const dynamic = url.includes("{{");
      if (dynamic && !/^[^{}]+\{\{1\}\}$/.test(url)) {
        issues.push({
          field: f,
          message: `Link button ${n}: a personalised link can only have {{1}}, and only at the very end.`,
          fix: "Use a link like https://promunch.in/{{1}}",
        });
      }
      const staticPart = url.replace(/\{\{[^{}]*\}\}/g, "");
      let parsed: URL | null = null;
      try { parsed = new URL(staticPart || "x:"); } catch { parsed = null; }
      if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
        issues.push({ field: f, message: `Link button ${n} is not a valid web address.`, fix: "Paste the full link, starting with https://" });
      } else if (parsed.protocol !== "https:") {
        issues.push({ field: f, message: `Link button ${n} must use https://, not http://.`, fix: "Change the start of the link to https://" });
      }
      if (dynamic) {
        const ex = Array.isArray(b.example) ? b.example[0] : b.example;
        const sample = String(ex ?? "").trim();
        if (!sample) {
          issues.push({
            field: f,
            message: `Link button ${n} is personalised, so Meta needs an example of a full link.`,
            fix: `Fill in "Example link", for example ${staticPart}abc123`,
          });
        } else if (!sample.startsWith(staticPart) || sample.length <= staticPart.length || sample.includes("{{")) {
          issues.push({
            field: f,
            message: `Link button ${n}: the example link must start with ${staticPart} and add something after it.`,
            fix: `For example ${staticPart}abc123`,
          });
        }
      }
    }
    if (type === "PHONE_NUMBER") {
      const phone = String(b.phone_number ?? "").replace(/[\s-]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        issues.push({
          field: f,
          message: `Call button ${n} needs a phone number in international format.`,
          fix: "Start with + and the country code, for example +919876543210",
        });
      }
    }
  });
  return issues;
}

// Every hard rule Meta enforces that we can check before submitting. An empty
// array means the template is safe to send to Meta for review.
export function validateCore(t: CoreTemplate): CoreIssue[] {
  const issues: CoreIssue[] = [];
  const name = String(t.name ?? "").trim();
  if (!name) {
    issues.push({ field: "name", message: "The template needs a name.", fix: "Type a title and we build the name for you." });
  } else if (!NAME_RE.test(name)) {
    issues.push({
      field: "name",
      message: "The name can only use lowercase letters, numbers and underscores.",
      fix: "For example diwali_offer_2026",
    });
  }

  const cat = String(t.category ?? "").trim().toLowerCase();
  if (cat === "authentication") {
    issues.push({
      field: "category",
      message: "Authentication (one-time password) templates cannot be built here.",
      fix: "Choose Marketing or Utility.",
    });
  }

  // Header
  const ht = String(t.header_type ?? "").toUpperCase();
  if (ht === "TEXT") {
    const h = String(t.header_text ?? "");
    if (!h.trim()) {
      issues.push({ field: "header", message: "The text header is empty.", fix: "Type a header, or choose No header." });
    } else {
      if (h.length > HEADER_TEXT_MAX) {
        issues.push({ field: "header", message: `The header is ${h.length} characters. The limit is ${HEADER_TEXT_MAX}.`, fix: "Shorten the header." });
      }
      if (/[\r\n]/.test(h)) issues.push({ field: "header", message: "The header cannot have line breaks.", fix: "Keep the header on one line." });
      if (hasEmoji(h)) issues.push({ field: "header", message: "The header has an emoji. Meta rejects emojis in text headers.", fix: "Remove the emoji. Emojis are fine in the message body." });
      if (/[*_~`]/.test(h)) issues.push({ field: "header", message: "The header cannot use bold, italic or other formatting.", fix: "Remove the * _ ~ or ` characters." });
      issues.push(...checkVariables(h, "header", "header", { maxVars: 1 }));
      const hv = varNumbers(h);
      const hs = t.header_samples ?? [];
      hv.forEach((n) => {
        if (!String(hs[n - 1] ?? "").trim()) {
          issues.push({ field: "header_samples", message: `Add an example value for {{${n}}} in the header.`, fix: "Meta's reviewer needs to see what a real value looks like." });
        }
      });
    }
  } else if (ht === "IMAGE" || ht === "VIDEO" || ht === "DOCUMENT") {
    if (!String(t.header_media_url ?? "").trim()) {
      const kind = ht === "IMAGE" ? "an image" : ht === "VIDEO" ? "a video" : "a PDF";
      issues.push({ field: "header", message: `Upload ${kind} for the header.`, fix: "Or choose No header." });
    }
  } else if (ht && ht !== "NONE") {
    issues.push({ field: "header", message: "Unknown header type.", fix: "Choose No header, Text, Image, Video or PDF." });
  }

  // Body
  const body = String(t.body ?? "");
  if (!body.trim()) {
    issues.push({ field: "body", message: "The message is empty.", fix: "Type the message your customers will read." });
  } else {
    if (body.length > BODY_MAX) {
      issues.push({ field: "body", message: `The message is ${body.length} characters. The limit is ${BODY_MAX}.`, fix: "Shorten the message." });
    }
    issues.push(...checkVariables(body, "body", "message"));
    const bv = varNumbers(body);
    if (bv.length && plainWordCount(body) < bv.length * 2) {
      issues.push({
        field: "body",
        message: "The message has too many placeholders for how short it is. Meta rejects these.",
        fix: "Add more fixed words around the placeholders, or use fewer placeholders.",
      });
    }
    const bs = t.body_samples ?? [];
    bv.forEach((n) => {
      if (!String(bs[n - 1] ?? "").trim()) {
        issues.push({ field: "body_samples", message: `Add an example value for {{${n}}}.`, fix: "Meta's reviewer needs to see what a real value looks like, for example a first name." });
      }
    });
  }

  // Footer (checked in its final, as-sent form)
  const rawFooter = String(t.footer ?? "");
  if (/\{\{/.test(rawFooter)) issues.push({ field: "footer", message: "The footer cannot contain placeholders.", fix: "Use fixed text in the footer." });
  if (hasEmoji(rawFooter)) issues.push({ field: "footer", message: "The footer has an emoji. Meta rejects emojis in footers.", fix: "Remove the emoji." });
  if (/[\r\n]/.test(rawFooter)) issues.push({ field: "footer", message: "The footer cannot have line breaks.", fix: "Keep the footer on one line." });
  const ff = finalFooter(t.category, rawFooter);
  if (ff && ff.length > FOOTER_MAX) {
    const room = FOOTER_MAX - FOOTER_SEPARATOR.length - STOP_NOTICE.length;
    issues.push({
      field: "footer",
      message: isMarketingCategory(t.category) && !STOP_WORD_RE.test(rawFooter)
        ? `Marketing footers must end with "${STOP_NOTICE}", and your footer plus that notice is ${ff.length} characters. The limit is ${FOOTER_MAX}.`
        : `The footer is ${ff.length} characters. The limit is ${FOOTER_MAX}.`,
      fix: isMarketingCategory(t.category) && !STOP_WORD_RE.test(rawFooter)
        ? `Shorten your footer to ${room} characters or less, or leave it empty.`
        : "Shorten the footer.",
    });
  }

  issues.push(...checkButtons(Array.isArray(t.buttons) ? t.buttons : []));
  return issues;
}
