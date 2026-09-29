// Editor state for the guided WhatsApp template creator, plus the pure
// conversions between that state, a saved wa_templates row and the request
// bodies of /api/whatsapp/templates (save draft) and /templates/submit.
// No React, safe in vitest.

import {
  STOP_NOTICE,
  isMarketingCategory,
  mediaKindForHeader,
  samplesArray,
  slugifyTemplateName,
  nextVersionName,
  varNumbers,
  type TemplateDraft,
} from "./template-rules";

export type HeaderKind = "" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
export const HEADER_KINDS: HeaderKind[] = ["", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"];

export type DraftButton =
  | { type: "URL"; text: string; url: string; example?: string }
  | { type: "QUICK_REPLY"; text: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

export type EditorDraft = {
  id?: string;
  /** new = never saved; draft = saved but never sent to Meta; edit = exists at Meta (resubmits in edit mode). */
  mode: "new" | "draft" | "edit";
  status?: string;
  title: string;
  name: string;
  nameTouched: boolean;
  language: string;
  category: string;
  header_type: HeaderKind;
  header_text: string;
  header_media_url: string | null;
  header_media?: { mime: string; size: number } | null;
  body: string;
  footer: string;
  buttons: DraftButton[];
  bodySamples: Record<string, string>;
  headerSamples: Record<string, string>;
  /** UI-only names for each body blank ("1" -> "First name"). */
  blankLabels: Record<string, string>;
};

/** Minimal shape of a wa_templates row that the editor reads. */
export type TemplateRowLike = {
  id: string;
  name: string;
  language?: string | null;
  category: string;
  status: string;
  body?: string | null;
  footer?: string | null;
  header_text?: string | null;
  header_type?: string | null;
  header_media_url?: string | null;
  buttons?: unknown[] | null;
  variables?: unknown;
  meta_template_id?: string | null;
  header_samples?: (string | null)[] | null;
};

export const FIRST_NAME_LABEL = "First name";
export const FIRST_NAME_SAMPLE = "Aarav";

export function emptyDraft(): EditorDraft {
  return {
    mode: "new", title: "", name: "", nameTouched: false, language: "en", category: "marketing",
    header_type: "", header_text: "", header_media_url: null, header_media: null, body: "", footer: "", buttons: [],
    bodySamples: {}, headerSamples: {}, blankLabels: {},
  };
}

/** A free name: the slug itself, or the next _vN when it is taken. */
export function uniqueName(slug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!slug || !used.has(slug)) return slug;
  return nextVersionName(slug, used);
}

/**
 * Guess a friendly label for each blank in a body we did not write
 * ("Hi {{1}}" -> First name). Anything else stays "Blank n".
 */
export function guessBlankLabels(body: string, known?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of varNumbers(body)) {
    const k = String(n);
    const given = known?.[k]?.trim();
    if (given) { out[k] = given; continue; }
    const re = new RegExp(`\\b(hi|hey|hello|dear|namaste)\\s*,?\\s*\\{\\{${n}\\}\\}`, "i");
    out[k] = re.test(body) ? FIRST_NAME_LABEL : `Blank ${n}`;
  }
  return out;
}

function toButtons(raw: unknown[] | null | undefined): DraftButton[] {
  return (raw ?? []).flatMap((x): DraftButton[] => {
    const b = (x ?? {}) as Record<string, unknown>;
    const text = String(b.text ?? "");
    const type = String(b.type ?? "").toUpperCase();
    if (type === "URL") {
      const ex = Array.isArray(b.example) ? b.example[0] : b.example;
      return [{ type: "URL", text, url: String(b.url ?? ""), example: ex == null ? "" : String(ex) }];
    }
    if (type === "PHONE_NUMBER") return [{ type: "PHONE_NUMBER", text, phone_number: String(b.phone_number ?? "") }];
    if (type === "QUICK_REPLY") return [{ type: "QUICK_REPLY", text }];
    return [];
  });
}

// Strip the STOP notice we add automatically, so re-opening a synced
// marketing template doesn't show it twice in the editable footer.
export function editableFooter(category: string, footer: string): string {
  if (!isMarketingCategory(category)) return footer;
  if (footer === STOP_NOTICE) return "";
  const suffix = ` · ${STOP_NOTICE}`;
  return footer.endsWith(suffix) ? footer.slice(0, -suffix.length) : footer;
}

/**
 * Editor state from a saved row. With `asNewName` it becomes a brand-new copy
 * (Duplicate as new version); otherwise it edits the row in place (resubmit
 * at Meta when it has a Meta id, else a local draft).
 */
export function draftFromRow(t: TemplateRowLike, asNewName?: string): EditorDraft {
  const bs: Record<string, string> = {};
  const labels: Record<string, string> = {};
  if (Array.isArray(t.variables)) {
    for (const v of t.variables as { name?: unknown; sample?: unknown; label?: unknown }[]) {
      if (!v?.name) continue;
      bs[String(v.name)] = String(v.sample ?? "");
      if (typeof v.label === "string" && v.label.trim()) labels[String(v.name)] = v.label;
    }
  }
  const hs: Record<string, string> = {};
  (t.header_samples ?? []).forEach((s, i) => { hs[String(i + 1)] = String(s ?? ""); });
  const submitted = !!t.meta_template_id;
  const copy = asNewName !== undefined;
  const ht = String(t.header_type ?? "").toUpperCase() as HeaderKind;
  const category = t.category === "authentication" ? "utility" : t.category;
  const body = t.body ?? "";
  return {
    id: copy ? undefined : t.id,
    mode: copy ? "new" : submitted ? "edit" : "draft",
    status: copy ? "draft" : t.status,
    title: copy ? asNewName : t.name,
    name: copy ? asNewName : t.name,
    nameTouched: true,
    language: t.language ?? "en",
    category,
    header_type: HEADER_KINDS.includes(ht) ? ht : "",
    header_text: t.header_text ?? "",
    header_media_url: t.header_media_url ?? null,
    header_media: null,
    body,
    footer: editableFooter(category, t.footer ?? ""),
    buttons: toButtons(t.buttons),
    bodySamples: bs,
    headerSamples: hs,
    blankLabels: guessBlankLabels(body, labels),
  };
}

export function buttonsForApi(buttons: DraftButton[]): DraftButton[] {
  return buttons.map((b): DraftButton => {
    if (b.type === "URL") {
      const dynamic = (b.url ?? "").includes("{{");
      const ex = (b.example ?? "").trim();
      return dynamic && ex
        ? { type: "URL", text: b.text.trim(), url: b.url.trim(), example: ex }
        : { type: "URL", text: b.text.trim(), url: b.url.trim() };
    }
    if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text.trim(), phone_number: b.phone_number.trim() };
    return { type: "QUICK_REPLY", text: b.text.trim() };
  });
}

/** The shape validateTemplate() checks. */
export function toRulesDraft(d: EditorDraft): TemplateDraft {
  return {
    name: d.name,
    language: d.language,
    category: d.category,
    header_type: d.header_type || null,
    header_text: d.header_type === "TEXT" ? d.header_text : null,
    header_media_url: d.header_media_url,
    header_media: d.header_media ?? null,
    body: d.body,
    footer: d.footer,
    buttons: d.buttons,
    body_samples: d.bodySamples,
    header_samples: d.headerSamples,
  };
}

/** POST /api/whatsapp/templates (save a local draft, never sent to Meta). */
export function saveDraftBody(d: EditorDraft) {
  return {
    id: d.id,
    name: d.name,
    language: d.language,
    category: d.category,
    header_type: d.header_type || null,
    header_text: d.header_type === "TEXT" ? d.header_text : null,
    header_media_url: mediaKindForHeader(d.header_type) ? d.header_media_url : null,
    body: d.body,
    footer: d.footer || null,
    buttons: d.buttons.length ? buttonsForApi(d.buttons) : null,
    variables: varNumbers(d.body).map((n) => ({
      name: String(n),
      sample: d.bodySamples[String(n)] ?? "",
      ...(d.blankLabels[String(n)] ? { label: d.blankLabels[String(n)] } : {}),
    })),
    header_samples: d.header_type === "TEXT" ? samplesArray(d.header_text, d.headerSamples) : null,
  };
}

/** POST /api/whatsapp/templates/submit (create, or edit when it already exists at Meta). */
export function submitBody(d: EditorDraft) {
  const isMedia = !!mediaKindForHeader(d.header_type);
  return {
    mode: d.mode === "edit" ? "edit" : "create",
    name: d.name,
    category: d.category,
    language: d.language,
    header_format: d.header_type || undefined,
    header_text: d.header_type === "TEXT" ? d.header_text : undefined,
    header_media_url: isMedia ? d.header_media_url : undefined,
    body: d.body,
    footer: d.footer || undefined,
    body_samples: samplesArray(d.body, d.bodySamples),
    header_samples: d.header_type === "TEXT" ? samplesArray(d.header_text, d.headerSamples) : [],
    buttons: d.buttons.length ? buttonsForApi(d.buttons) : undefined,
  };
}

/**
 * Insert the next blank at `at`. A first-name blank typed into an empty
 * message (or at its very start) becomes "Hi {{n}}, " because Meta rejects a
 * message that starts with a blank.
 */
export function insertBlank(
  body: string,
  at: number,
  kind: "first_name" | "custom",
): { body: string; n: number; cursor: number } {
  const n = (varNumbers(body).pop() ?? 0) + 1;
  const pos = Math.max(0, Math.min(at, body.length));
  const token = `{{${n}}}`;
  let insert = token;
  if (kind === "first_name" && body.slice(0, pos).trim() === "") insert = `Hi ${token}, `;
  else {
    const before = body.slice(0, pos);
    const after = body.slice(pos);
    if (before && !/\s$/.test(before)) insert = ` ${insert}`;
    if (after && !/^[\s,.!?:;]/.test(after)) insert = `${insert} `;
  }
  return { body: body.slice(0, pos) + insert + body.slice(pos), n, cursor: pos + insert.length };
}

/**
 * Renumber the blanks so they read {{1}}, {{2}}... with no gaps (keeping their
 * order), carrying samples and labels across. Fixes Meta's "numbered in
 * order" rule after a blank was deleted.
 */
export function renumberBlanks(
  body: string,
  samples: Record<string, string>,
  labels: Record<string, string>,
): { body: string; samples: Record<string, string>; labels: Record<string, string> } {
  const nums = varNumbers(body);
  const map = new Map<number, number>();
  nums.forEach((n, i) => map.set(n, i + 1));
  const next = body.replace(/\{\{(\d+)\}\}/g, (_, n) => `{{${map.get(Number(n)) ?? n}}}`);
  const s: Record<string, string> = {};
  const l: Record<string, string> = {};
  for (const [from, to] of map) {
    if (samples[String(from)] !== undefined) s[String(to)] = samples[String(from)];
    if (labels[String(from)] !== undefined) l[String(to)] = labels[String(from)];
  }
  return { body: next, samples: s, labels: l };
}

/** True when the blanks have gaps (or start above 1) that renumberBlanks would fix. */
export function blanksNeedRenumber(body: string): boolean {
  const nums = varNumbers(body);
  return nums.some((n, i) => n !== i + 1);
}

/** Title typed by the marketer -> Meta name, unless they edited the name by hand. */
export function applyTitle(d: EditorDraft, title: string, taken: Iterable<string>): EditorDraft {
  if (d.nameTouched || d.mode === "edit") return { ...d, title };
  return { ...d, title, name: uniqueName(slugifyTemplateName(title), taken) };
}

/** Stable fingerprint of the content, for "unsaved changes?" checks. */
export function draftFingerprint(d: EditorDraft): string {
  const rest: Partial<EditorDraft> = { ...d };
  delete rest.header_media;
  delete rest.nameTouched;
  return JSON.stringify(rest);
}
