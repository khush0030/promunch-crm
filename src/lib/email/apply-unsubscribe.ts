// The DB side of unsubscribe: suppress a contact from all future marketing.
// Split from ./unsubscribe (pure crypto) so the token helpers stay unit-testable
// and free of a Supabase import. Server-only.

import { supabaseAdmin } from "@/lib/supabase-admin";

export type UnsubResult = { ok: boolean; email?: string };

/**
 * Idempotent: safe to call from the one-click POST, the footer-link GET, and
 * the confirmation page. Writes the address into `suppressions` (the list both
 * the campaign and flow senders check) and flips the contact's consent.
 */
export async function applyUnsubscribe(contactId: string): Promise<UnsubResult> {
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, email")
    .eq("id", contactId)
    .maybeSingle();

  // No email on file (phone-only contact) or already deleted: nothing to
  // suppress, but the request still succeeded from the caller's side.
  const email = (contact?.email as string | undefined)?.toLowerCase() ?? null;

  if (email) {
    await supabaseAdmin
      .from("suppressions")
      .upsert({ email, reason: "unsubscribe" }, { onConflict: "email", ignoreDuplicates: true });
  }

  await supabaseAdmin
    .from("contacts")
    .update({ status: "unsubscribed", accepts_marketing: false, email_consent: "unsubscribed" })
    .eq("id", contactId);

  return { ok: true, email: email ?? undefined };
}
