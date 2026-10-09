// Pure validation for "New deal" (POST /api/deals). Turns the form body into
// a deals row or a plain-words error. No I/O.
//
// The deals table (migration 20260717130000_deal_pipeline.sql) has no numeric
// value column; the deal's value goes into `commercials` (free text, the same
// field the deal scanner fills with terms like "₹40k/month"). A hand-made
// deal is marked manual_stage_override so the scanner never moves its stage,
// and company_domain comes from a work email so later emails from that
// company attach to this deal instead of opening a duplicate.

import { ALL_KINDS, ALL_STAGES } from "@/components/deals/constants";
import type { DealKind, DealStage } from "@/components/deals/types";

export type NewDealInsert = {
  company_name: string;
  company_domain: string | null;
  kind: DealKind;
  contact_name: string | null;
  contact_email: string | null;
  stage: DealStage;
  manual_stage_override: true;
  commercials: string | null;
  notes: string | null;
  next_step: string | null;
  samples_sent_at?: string;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
}

function longText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
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
): { ok: true; row: NewDealInsert } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the deal as JSON." };
  const b = body as Record<string, unknown>;

  const company = text(b.company_name, 200);
  if (!company) return { ok: false, error: "Add the business name." };

  const email = text(b.contact_email, 200)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "That email doesn't look right." };

  const stage = (b.stage ?? "new_inquiry") as DealStage;
  if (!(ALL_STAGES as string[]).includes(stage)) return { ok: false, error: "Pick a stage from the list." };

  const kind = (b.kind ?? "other") as DealKind;
  if (!(ALL_KINDS as string[]).includes(kind)) return { ok: false, error: "Pick a type from the list." };

  const row: NewDealInsert = {
    company_name: company,
    company_domain: workDomain(email),
    kind,
    contact_name: text(b.contact_name, 120),
    contact_email: email,
    stage,
    manual_stage_override: true,
    commercials: text(b.value, 200),
    notes: longText(b.notes, 4000),
    next_step: text(b.next_step, 500),
  };
  if (stage === "samples_sent") row.samples_sent_at = now.toISOString();
  return { ok: true, row };
}
