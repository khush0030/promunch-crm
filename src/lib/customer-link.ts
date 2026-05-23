import { supabaseAdmin } from "@/lib/supabase-admin";

// Shared matching layer for the unified customer record.
//
// A person can exist as a CRM `contacts` row (keyed by email) and a
// `wa_contacts` row (keyed by phone / wa_id) with nothing linking them.
// These helpers resolve one from the other so orders, email events and
// WhatsApp activity collapse onto a single customer.
//
// Match priority: shopify_customer_id → email → last-10-digit phone.
// If migration 003 has been applied, the persisted `wa_contacts.contact_id`
// is used as a fast path — but everything still works without it.

const WA_FIELDS = "id, wa_id, phone, email, name, shopify_customer_id";
const CRM_FIELDS =
  "id, email, first_name, last_name, phone, tags, status, total_orders, " +
  "total_spent, last_purchase_date, city, state, shopify_customer_id";

export type WaContactLite = {
  id: string;
  wa_id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  shopify_customer_id: string | null;
};

export type CrmContactLite = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  tags: string[] | null;
  status: string | null;
  total_orders: number | null;
  total_spent: number | null;
  last_purchase_date: string | null;
  city: string | null;
  state: string | null;
  shopify_customer_id: string | null;
};

// Last 10 digits of a phone number — the stable key for fuzzy matching
// between a free-form CRM phone and an E.164-style WhatsApp wa_id.
export function phoneKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-10);
}

// Find the WhatsApp contact for a CRM contact (if any).
export async function findWaContactForCrm(crm: {
  id?: string;
  email?: string | null;
  phone?: string | null;
  shopify_customer_id?: string | null;
}): Promise<WaContactLite | null> {
  // Fast path: persisted link from migration 003. If the column does not
  // exist yet, PostgREST returns an error object and we fall through.
  if (crm.id) {
    const linked = await supabaseAdmin
      .from("wa_contacts")
      .select(WA_FIELDS)
      .eq("contact_id", crm.id)
      .limit(1);
    if (!linked.error && linked.data?.[0]) return linked.data[0] as unknown as WaContactLite;
  }

  if (crm.shopify_customer_id) {
    const { data } = await supabaseAdmin
      .from("wa_contacts")
      .select(WA_FIELDS)
      .eq("shopify_customer_id", crm.shopify_customer_id)
      .limit(1);
    if (data?.[0]) return data[0] as unknown as WaContactLite;
  }

  if (crm.email) {
    const { data } = await supabaseAdmin
      .from("wa_contacts")
      .select(WA_FIELDS)
      .ilike("email", crm.email)
      .limit(1);
    if (data?.[0]) return data[0] as unknown as WaContactLite;
  }

  const key = phoneKey(crm.phone);
  if (key) {
    const { data } = await supabaseAdmin
      .from("wa_contacts")
      .select(WA_FIELDS)
      .ilike("wa_id", `%${key}%`)
      .limit(1);
    if (data?.[0]) return data[0] as unknown as WaContactLite;
  }

  return null;
}

// Find the CRM contact for a WhatsApp identity (if any).
export async function findCrmContactForWa(wa: {
  email?: string | null;
  wa_id?: string | null;
  phone?: string | null;
  shopify_customer_id?: string | null;
}): Promise<CrmContactLite | null> {
  if (wa.shopify_customer_id) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(CRM_FIELDS)
      .eq("shopify_customer_id", wa.shopify_customer_id)
      .maybeSingle();
    if (data) return data as unknown as CrmContactLite;
  }

  if (wa.email) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(CRM_FIELDS)
      .ilike("email", wa.email)
      .maybeSingle();
    if (data) return data as unknown as CrmContactLite;
  }

  const key = phoneKey(wa.phone || wa.wa_id);
  if (key) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(CRM_FIELDS)
      .ilike("phone", `%${key}%`)
      .limit(1);
    if (data?.[0]) return data[0] as unknown as CrmContactLite;
  }

  return null;
}
