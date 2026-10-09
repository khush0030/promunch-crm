// Pure validation for POST /api/deals (the "Add a deal" form, "Create deal"
// from a WhatsApp chat, "Make it a deal" on a B2B reply, the bulk form).
// Turns the body into a deals row or a plain-words error. No I/O.
//
// Accepted body (all optional except one way to name the deal):
//   company | company_name, contact_name, contact_email, contact_phone,
//   kind (DealKind or alias like "wholesale"), stage (new name or old),
//   notes, next_step, follow_up_at (YYYY-MM-DD), value | value_inr,
//   owner_email, source ("whatsapp" | "b2b_reply" | "bulk_form" |
//   "email_scan" | "manual"), source_ref (thread id / lead id / B-1234).
//
// A hand-made deal is marked manual_stage_override (the scanner never moves
// its stage) and human_touched_at (the scanner never overrides its next step
// or follow-up until a new inbound email arrives).

import { normalizeStage, type DealStage } from "./stages";
import { normalizePhone, parseKind, parseRupees, parseSource, type DealKind, type DealSource } from "./model";

export type NewDealInsert = {
  company_name: string;
  company_domain: string | null;
  kind: DealKind;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  stage: DealStage;
  stage_updated_at: string;
  manual_stage_override: true;
  human_touched_at: string;
  next_step: string | null;
  next_step_owner: "us" | null;
  follow_up_at: string | null;
  value_inr: number | null;
  owner_email: string | null;
  source: DealSource;
  source_ref: string | null;
};

export type ParsedNewDeal = {
  row: NewDealInsert;
  /** Free-text notes: become the first activity entry. */
  note: string | null;
  /** Value typed as words we could not turn into ₹ ("200 packs a month"). */
  valueText: string | null;
};

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "rediffmail.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "zoho.com",
]);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
}

export function longText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export function validDate(v: unknown): string | null {
  if (typeof v !== "string" || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export function workDomain(email: string | null): string | null {
  if (!email) return null;
  const d = email.split("@")[1]?.toLowerCase().trim();
  if (!d || FREE_MAIL.has(d)) return null;
  return d;
}

export function parseNewDeal(
  body: unknown,
  now: Date = new Date(),
): { ok: true; value: ParsedNewDeal } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the deal as JSON." };
  const b = body as Record<string, unknown>;

  const email = text(b.contact_email, 200)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "That email doesn't look right." };

  const rawPhone = text(b.contact_phone, 40);
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, error: "That phone number doesn't look right." };

  const contactName = text(b.contact_name, 120);
  const company = text(b.company, 200) ?? text(b.company_name, 200) ?? contactName ?? email ?? (phone ? `+${phone}` : null);
  if (!company) return { ok: false, error: "Add the business name." };

  const stage = b.stage == null || b.stage === "" ? "new" : normalizeStage(b.stage);
  if (!stage) return { ok: false, error: "Pick a stage from the list." };

  const kind = b.kind == null || b.kind === "" ? "other" : parseKind(b.kind);
  if (!kind) return { ok: false, error: "Pick a type from the list." };

  const source = b.source == null || b.source === "" ? "manual" : parseSource(b.source);
  if (!source) return { ok: false, error: "Unknown source." };

  let followUpAt: string | null = null;
  if (b.follow_up_at != null && b.follow_up_at !== "") {
    followUpAt = validDate(b.follow_up_at);
    if (!followUpAt) return { ok: false, error: "Pick a real follow-up date." };
  }

  const ownerEmail = text(b.owner_email, 200)?.toLowerCase() ?? null;
  if (ownerEmail && !EMAIL_RE.test(ownerEmail)) return { ok: false, error: "Pick an owner from the team list." };

  const rawValue = b.value_inr ?? b.value;
  const valueInr = rawValue == null || rawValue === "" ? null : parseRupees(rawValue);
  const valueText = valueInr == null && typeof rawValue === "string" ? text(rawValue, 200) : null;

  const nextStep = text(b.next_step, 500);
  const iso = now.toISOString();

  const row: NewDealInsert = {
    company_name: company,
    company_domain: workDomain(email),
    kind,
    contact_name: contactName,
    contact_email: email,
    contact_phone: phone,
    stage,
    stage_updated_at: iso,
    manual_stage_override: true,
    human_touched_at: iso,
    next_step: nextStep,
    next_step_owner: nextStep ? "us" : null,
    follow_up_at: followUpAt,
    value_inr: valueInr,
    owner_email: ownerEmail,
    source,
    source_ref: text(b.source_ref, 200),
  };

  const notes = longText(b.notes, 4000);
  const note = [notes, valueText ? `Value: ${valueText}` : null].filter(Boolean).join("\n") || null;
  return { ok: true, value: { row, note, valueText } };
}
