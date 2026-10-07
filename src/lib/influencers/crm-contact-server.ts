// Server-only: upsert the creator's CRM contact at kit dispatch time, so the
// "influencer" + "creator" tags and properties.instagram_url are there before
// the Shopify order webhook lands (which applies the same merge edge-side).
//
// Identity mirrors the webhook's syncContactFromOrder so both converge on ONE
// row: email when we have one, else the phone (contacts.email is nullable).
// Never touches an anonymized row (GDPR). Writes no consent fields, so this
// never makes the creator marketable by email; wa_contacts is not touched.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { cleanEmail, influencerContactFields, phoneVariants } from "./crm-contact";

export type InfluencerContactResult =
  | { ok: true; action: "created" | "updated" | "skipped_anonymized"; contact_id: string | null }
  | { ok: false; reason: string };

type Existing = {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  tags: string[] | null;
  properties: Record<string, unknown> | null;
  anonymized_at: string | null;
};

const COLS = "id,email,phone,first_name,last_name,tags,properties,anonymized_at";

async function findExisting(email: string | null, waId: string | null): Promise<{ row: Existing | null; error?: string }> {
  if (email) {
    const { data, error } = await supabaseAdmin.from("contacts").select(COLS).eq("email", email).maybeSingle();
    if (error) return { row: null, error: error.message };
    return { row: (data as Existing | null) ?? null };
  }
  if (waId) {
    const { data, error } = await supabaseAdmin.from("contacts").select(COLS).in("phone", phoneVariants(waId)).limit(1);
    if (error) return { row: null, error: error.message };
    return { row: ((data ?? [])[0] as Existing | undefined) ?? null };
  }
  return { row: null };
}

async function updateExisting(row: Existing, handle: string, waId: string | null, first: string | null, last: string | null): Promise<InfluencerContactResult> {
  if (row.anonymized_at) return { ok: true, action: "skipped_anonymized", contact_id: row.id };
  const f = influencerContactFields(row, handle);
  const patch: Record<string, unknown> = { tags: f.tags, properties: f.properties };
  if (!row.phone && waId) patch.phone = `+${waId}`;
  if (!row.first_name && first) patch.first_name = first;
  if (!row.last_name && last) patch.last_name = last;
  const { error } = await supabaseAdmin.from("contacts").update(patch).eq("id", row.id).is("anonymized_at", null);
  if (error) return { ok: false, reason: `update: ${error.message}` };
  return { ok: true, action: "updated", contact_id: row.id };
}

export async function upsertInfluencerContact(input: {
  handle: string;
  email?: string | null;
  /** Digits with country code (wa_id shape), e.g. 919876543210. */
  phone?: string | null;
  fullName?: string | null;
}): Promise<InfluencerContactResult> {
  const email = cleanEmail(input.email);
  const waId = String(input.phone ?? "").replace(/\D/g, "") || null;
  if (!email && !waId) return { ok: false, reason: "no-identity" };
  const parts = String(input.fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? null;
  const last = parts.slice(1).join(" ") || null;

  const found = await findExisting(email, waId);
  if (found.error) return { ok: false, reason: `read: ${found.error}` };
  if (found.row) return updateExisting(found.row, input.handle, waId, first, last);

  const f = influencerContactFields(null, input.handle);
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      email,
      phone: waId ? `+${waId}` : null,
      first_name: first,
      last_name: last,
      tags: f.tags,
      properties: f.properties,
      source: "influencer",
      status: "active",
    })
    .select("id")
    .maybeSingle();
  if (!error) return { ok: true, action: "created", contact_id: (data?.id as string | undefined) ?? null };
  // 23505: the order webhook (or a parallel request) inserted the same identity
  // first. Merge onto that row instead.
  if (error.code === "23505") {
    const again = await findExisting(email, waId);
    if (again.row) return updateExisting(again.row, input.handle, waId, first, last);
  }
  return { ok: false, reason: `insert: ${error.message}` };
}
