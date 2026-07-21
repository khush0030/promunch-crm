// Pure helpers for the B2B Leads dashboard. Extracted from
// dashboard/leads/page.tsx.

import type { Contact, Lead } from "./types";

export function fitPill(score: number | null): { cls: string; label: string } {
  if (score == null) return { cls: "bg-gray", label: "—" };
  if (score >= 70) return { cls: "bg-green", label: String(score) };
  if (score >= 50) return { cls: "bg-gold", label: String(score) };
  return { cls: "bg-terra", label: String(score) };
}

export function bestContact(lead: Lead): Contact | null {
  const contacts = lead.lead_contacts ?? [];
  return contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
}

// The contact a campaign would actually send to — mirrors the enroll API's
// primary + mx_ok rule. A lead can have contacts yet still not be sendable.
export function verifiedContact(lead: Lead): Contact | null {
  const contacts = lead.lead_contacts ?? [];
  return (
    contacts.find((c) => c.is_primary && c.verify_status === "mx_ok") ??
    contacts.find((c) => c.verify_status === "mx_ok") ??
    null
  );
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
