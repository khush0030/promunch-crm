// Email opt-in from a storefront popup. Shared by /api/public/email-optin
// (email-only popup) and /api/public/wa-optin (phone popup with an email
// field), so both record consent the same way.
//
// Merge, never clobber: an existing contact keeps their data and gains
// consent + the "popup" tag. Never sends anything; a customer_created
// automation (if one is switched on) picks the contact up.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { enrollEmailFlow } from "@/lib/email/enroll";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function recordEmailOptIn(opts: {
  email: string;
  firstName?: string | null;
  phone?: string | null;
  source: "website_popup" | "website_widget";
  consentText?: string | null;
}): Promise<{ contactId: string | null; already: boolean }> {
  const email = opts.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();

  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id, tags, phone, first_name")
    .eq("email", email)
    .maybeSingle();

  const tags = new Set<string>(Array.isArray(existing?.tags) ? (existing!.tags as string[]) : []);
  tags.add("popup");

  const consent: Record<string, unknown> = {
    accepts_marketing: true,
    email_consent: "subscribed",
    consent_source: opts.source,
    consent_timestamp: nowIso,
    tags: [...tags],
    status: "active",
  };

  let contactId = (existing?.id as string | undefined) ?? null;
  if (contactId) {
    const patch = { ...consent };
    if (!existing?.phone && opts.phone) patch.phone = opts.phone;
    if (!existing?.first_name && opts.firstName) patch.first_name = opts.firstName;
    await supabaseAdmin.from("contacts").update(patch).eq("id", contactId);
  } else {
    const { data: ins } = await supabaseAdmin
      .from("contacts")
      .insert({ email, first_name: opts.firstName ?? null, phone: opts.phone ?? null, source: "manual", ...consent })
      .select("id")
      .maybeSingle();
    contactId = (ins?.id as string | undefined) ?? null;
  }

  if (contactId) {
    await enrollEmailFlow("customer_created", {
      email,
      entityRef: contactId,
      dedupPrefix: "welcome",
      firstName: opts.firstName ?? null,
    }).catch(() => {});
  }
  return { contactId, already: !!existing };
}
