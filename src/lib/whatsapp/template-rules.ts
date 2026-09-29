// WhatsApp template validation for the dashboard builder. Pure and
// framework-free so it runs in the browser (live validation panel), in the
// Next.js API routes (server-side re-check) and in vitest.
//
// Hard rules Meta enforces live in ./template-rules-core.ts, which is
// duplicated byte-for-byte into the edge function (_shared/template-rules.ts)
// so the server re-validates with the exact same logic. This file adds the
// dashboard-only pieces: the language list, media limits, warnings and small
// helpers for naming.

import {
  plainWordCount,
  validateCore,
  varNumbers,
  type CoreButton,
  type CoreIssue,
} from "./template-rules-core";

export {
  BODY_MAX,
  BUTTON_TEXT_MAX,
  FOOTER_MAX,
  HEADER_TEXT_MAX,
  MAX_BUTTONS,
  MAX_PHONE_BUTTONS,
  MAX_URL_BUTTONS,
  NAME_RE,
  STOP_NOTICE,
  checkVariables,
  finalFooter,
  hasEmoji,
  isMarketingCategory,
  varNumbers,
} from "./template-rules-core";

export type Issue = CoreIssue;
export type ValidationResult = { errors: Issue[]; warnings: Issue[] };

export type TemplateDraft = {
  name?: string | null;
  language?: string | null;
  category?: string | null;
  header_type?: string | null;
  header_text?: string | null;
  header_media_url?: string | null;
  /** Optional details of a header file picked in this session (for size/type checks). */
  header_media?: { mime?: string | null; size?: number | null } | null;
  body?: string | null;
  footer?: string | null;
  buttons?: CoreButton[] | null;
  /** Example values, by variable number ("1" -> "Aarav") or as an ordered array. */
  body_samples?: Record<string, string> | string[] | null;
  header_samples?: Record<string, string> | string[] | null;
};

/* ------------------------------------------------------------------------ */
/* Languages                                                                  */
/* ------------------------------------------------------------------------ */

// Curated Meta template language codes. The code is what Meta stores; the
// label is what staff see. Codes from Meta's "Supported languages" list.
export const TEMPLATE_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "hi", label: "Hindi" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "bn", label: "Bengali" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
  { code: "or", label: "Odia" },
  { code: "as", label: "Assamese" },
  { code: "ar", label: "Arabic" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
];

export function languageLabel(code: string | null | undefined): string {
  return TEMPLATE_LANGUAGES.find((l) => l.code === code)?.label ?? String(code ?? "");
}

/* ------------------------------------------------------------------------ */
/* Header media                                                               */
/* ------------------------------------------------------------------------ */

export type MediaKind = "image" | "video" | "document";

export const MEDIA_LIMITS: Record<MediaKind, { mimes: string[]; maxBytes: number; label: string; accept: string }> = {
  image: { mimes: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024, label: "JPG or PNG, up to 5 MB", accept: "image/jpeg,image/png" },
  video: { mimes: ["video/mp4", "video/3gpp"], maxBytes: 16 * 1024 * 1024, label: "MP4 or 3GP, up to 16 MB", accept: "video/mp4,video/3gpp" },
  document: { mimes: ["application/pdf"], maxBytes: 100 * 1024 * 1024, label: "PDF, up to 100 MB", accept: "application/pdf" },
};

export function mediaKindForHeader(headerType: string | null | undefined): MediaKind | null {
  const v = String(headerType ?? "").toUpperCase();
  if (v === "IMAGE") return "image";
  if (v === "VIDEO") return "video";
  if (v === "DOCUMENT") return "document";
  return null;
}

function fmtMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Check a file BEFORE uploading it. Returns null when fine, or a plain-English
// problem description.
export function validateMediaFile(
  kind: MediaKind,
  file: { type?: string | null; size?: number | null; name?: string | null },
): string | null {
  const rule = MEDIA_LIMITS[kind];
  if (!rule) return "Unknown file type.";
  const mime = String(file.type ?? "").toLowerCase();
  if (!rule.mimes.includes(mime)) {
    const what = kind === "image" ? "an image" : kind === "video" ? "a video" : "a PDF";
    return `That file is not ${what} WhatsApp accepts here. Use ${rule.label}.`;
  }
  const size = Number(file.size ?? 0);
  if (!size) return "That file is empty.";
  if (size > rule.maxBytes) {
    return `That file is ${fmtMb(size)}. The limit is ${fmtMb(rule.maxBytes)} (${rule.label}). Compress it or pick a smaller one.`;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Naming helpers                                                             */
/* ------------------------------------------------------------------------ */

// Friendly title -> Meta template name ("Diwali Offer 2026!" -> "diwali_offer_2026").
export function slugifyTemplateName(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

// Next free "_vN" name for "Duplicate as new version".
// diwali_offer -> diwali_offer_v2; diwali_offer_v2 -> diwali_offer_v3 (or
// higher if that is taken too).
export function nextVersionName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const m = name.match(/^(.*)_v(\d+)$/);
  const base = m ? m[1] : name;
  let n = m ? Number(m[2]) + 1 : 2;
  while (used.has(`${base}_v${n}`)) n++;
  return `${base}_v${n}`;
}

/* ------------------------------------------------------------------------ */
/* Samples                                                                    */
/* ------------------------------------------------------------------------ */

// Ordered sample array for the {{1}}..{{n}} in `text`.
export function samplesArray(
  text: string | null | undefined,
  samples: Record<string, string> | string[] | null | undefined,
): string[] {
  const nums = varNumbers(text);
  if (!nums.length) return [];
  const max = nums[nums.length - 1];
  const out: string[] = [];
  for (let i = 1; i <= max; i++) {
    const v = Array.isArray(samples) ? samples[i - 1] : samples?.[String(i)];
    out.push(String(v ?? ""));
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Warnings                                                                   */
/* ------------------------------------------------------------------------ */

const PROMO_WORDS = /\b(offer|offers|discount|discounts|sale|deal|deals|coupon|promo|promocode|cashback|free\s+gift|flat\s+\d+|buy\s+\d+\s+get|limited\s+time|hurry|shop\s+now|new\s+launch|% ?off)\b|\d+\s?%\s?off/i;

function stripUrls(s: string): string {
  return s.replace(/https?:\/\/\S+/gi, " ").replace(/\b[\w-]+\.(in|com|co|app|store)\b\S*/gi, " ");
}

function warningsFor(d: TemplateDraft): Issue[] {
  const w: Issue[] = [];
  const body = String(d.body ?? "");
  const cat = String(d.category ?? "").toLowerCase();

  if (cat === "utility") {
    const text = [d.header_text, body, d.footer, ...(d.buttons ?? []).map((b) => b.text)].join(" ");
    if (PROMO_WORDS.test(text)) {
      w.push({
        field: "category",
        message: "This reads like a promotion (offer, discount, sale). Meta will likely move it to Marketing, which is charged at the marketing rate and counts toward the daily marketing limit.",
        fix: "Choose Marketing, or remove the promotional wording if this is really an order or account update.",
      });
    }
  }

  const bv = varNumbers(body);
  if (bv.length && plainWordCount(body) >= bv.length * 2 && plainWordCount(body) < bv.length * 4) {
    w.push({
      field: "body",
      message: "The message is short for the number of placeholders. Meta sometimes rejects these.",
      fix: "Add a little more fixed text around the placeholders.",
    });
  }

  const allCopy = [d.header_text, body, d.footer, ...(d.buttons ?? []).map((b) => b.text)].filter(Boolean).join("\n");
  if (/—/.test(allCopy)) {
    w.push({ field: "body", message: "The copy has a long dash (—). PROMUNCH copy never uses them.", fix: "Use a comma, full stop or colon instead." });
  }
  const noUrls = stripUrls(allCopy);
  if ((noUrls.match(/\bpromunch\b/gi) ?? []).some((m) => m !== "PROMUNCH")) {
    w.push({ field: "body", message: "The brand name should always be written PROMUNCH, in capitals.", fix: "Change it to PROMUNCH." });
  }

  const samples = [
    ...samplesArray(body, d.body_samples ?? null),
    ...samplesArray(d.header_text, d.header_samples ?? null),
  ];
  if (samples.some((s) => /[\r\n\t]/.test(s) || / {4,}/.test(s))) {
    w.push({ field: "body_samples", message: "An example value has a line break, tab or long run of spaces. Meta rejects those in values.", fix: "Keep each example on one short line." });
  }

  return w;
}

/* ------------------------------------------------------------------------ */
/* Main entry                                                                 */
/* ------------------------------------------------------------------------ */

export function validateTemplate(draft: TemplateDraft): ValidationResult {
  const errors: Issue[] = [];

  const lang = String(draft.language ?? "").trim();
  if (!lang) {
    errors.push({ field: "language", message: "Choose a language.", fix: "Pick the language the message is written in." });
  } else if (!TEMPLATE_LANGUAGES.some((l) => l.code === lang)) {
    errors.push({ field: "language", message: `"${lang}" is not a language code we support.`, fix: "Pick a language from the list." });
  }
  const cat = String(draft.category ?? "").trim().toLowerCase();
  if (!["marketing", "utility", "offer", "authentication"].includes(cat)) {
    errors.push({ field: "category", message: "Choose Marketing or Utility.", fix: undefined });
  }

  errors.push(
    ...validateCore({
      name: draft.name,
      category: draft.category,
      header_type: draft.header_type,
      header_text: draft.header_text,
      header_media_url: draft.header_media_url,
      body: draft.body,
      footer: draft.footer,
      buttons: draft.buttons,
      body_samples: samplesArray(draft.body, draft.body_samples ?? null),
      header_samples: samplesArray(draft.header_text, draft.header_samples ?? null),
    }),
  );

  const kind = mediaKindForHeader(draft.header_type);
  if (kind && draft.header_media && (draft.header_media.mime || draft.header_media.size)) {
    const problem = validateMediaFile(kind, { type: draft.header_media.mime, size: draft.header_media.size });
    if (problem) errors.push({ field: "header", message: problem });
  }

  return { errors, warnings: warningsFor(draft) };
}

// Issues for one field (prefix match, so "buttons" also returns "buttons.0").
export function issuesFor(issues: Issue[], field: string): Issue[] {
  return issues.filter((i) => i.field === field || i.field.startsWith(field + "."));
}
