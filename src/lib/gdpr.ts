import { supabaseAdmin } from "@/lib/supabase-admin";

// GDPR / DPDP data-subject tooling for a CRM contact:
//   - buildExport(): everything we hold about them (right to access)
//   - anonymizeContact(): scrub identifying fields in place, keep financial
//     rows linked for accounting integrity (right to erasure, our chosen shape)

// Gather every row that references a contact, across the CRM tables. Each table
// is queried defensively so a missing/renamed table never breaks the export.
export async function buildExport(contactId: string) {
  const out: Record<string, unknown> = { contact_id: contactId, exported_at: new Date().toISOString() };

  const { data: contact } = await supabaseAdmin.from("contacts").select("*").eq("id", contactId).maybeSingle();
  out.contact = contact ?? null;
  const phone = (contact as { phone?: string | null } | null)?.phone ?? null;

  const safe = async (label: string, run: () => PromiseLike<{ data: unknown }>) => {
    try { out[label] = (await run()).data ?? []; } catch { out[label] = []; }
  };

  await safe("orders", () => supabaseAdmin.from("orders").select("*").eq("contact_id", contactId));
  await safe("email_events", () => supabaseAdmin.from("email_events").select("*").eq("contact_id", contactId));

  // WhatsApp data keys on the phone number, not contact_id.
  if (phone) {
    await safe("wa_contacts", () => supabaseAdmin.from("wa_contacts").select("*").eq("phone", phone));
    await safe("wa_messages", () =>
      supabaseAdmin.from("wa_messages").select("*").eq("wa_id", phone.replace(/^\+/, "")));
  }

  return out;
}

// Scrub the PII columns on the contact row in place. Orders/messages remain for
// financial + audit integrity but no longer identify a person. Returns the
// contact's email (pre-scrub) for the audit summary, or null if not found.
export async function anonymizeContact(contactId: string): Promise<{ ok: boolean; wasEmail: string | null }> {
  const { data: existing } = await supabaseAdmin
    .from("contacts").select("email, anonymized_at").eq("id", contactId).maybeSingle();
  if (!existing) return { ok: false, wasEmail: null };

  const wasEmail = (existing as { email: string | null }).email;
  // email is NOT NULL UNIQUE — replace with a stable, unusable placeholder.
  const shortId = contactId.replace(/-/g, "").slice(0, 12);
  const scrub = {
    email: `redacted+${shortId}@anonymized.invalid`,
    first_name: null, last_name: null, phone: null,
    city: null, state: null, country: null,
    address1: null, address2: null, zip: null,
    locale: null, timezone: null, organization: null, title: null,
    klaviyo_id: null, external_id: null,
    tags: null,
    status: "unsubscribed",
    anonymized_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("contacts").update(scrub).eq("id", contactId);
  return { ok: !error, wasEmail };
}
