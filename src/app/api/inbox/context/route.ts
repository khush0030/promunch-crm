import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { findCrmContactForWa, findWaContactForCrm, phoneKey } from "@/lib/customer-link";
import {
  buildContext,
  ORDER_FETCH_LIMIT,
  type CtxCrmContact,
  type CtxEmailThread,
  type CtxOrderRow,
  type CtxWaContact,
  type CtxWaMessage,
  type CtxWaThread,
} from "@/lib/inbox/context";

// GET /api/inbox/context?key=wa-<uuid>|em-<uuid>
// Read-only customer panel for Live chats (third column): who this person
// is and their history across channels (orders, COD gate, WhatsApp
// thread, support emails, tickets). Session-gated by middleware under the
// /api/inbox prefix (Inbox area). Never writes and never marks anything
// read: the open conversation's own GET owns that.

export const dynamic = "force-dynamic";

const STORE_HANDLE = (process.env.SHOPIFY_STORE_URL || "").replace(/\.myshopify\.com$/i, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only plain addresses go into a PostgREST or() filter.
const SAFE_EMAIL = /^[^\s,()"'\\]+@[^\s,()"'\\]+\.[^\s,()"'\\]+$/;

const WA_CONTACT_COLS = "wa_id, phone, name, email, tags, opted_in, created_at, shopify_customer_id";
const WA_THREAD_COLS =
  "id, status, ticket_status, ticket_number, ticket_category, ticket_subject, escalation_reason, ticket_opened_at, ticket_resolved_at, last_message_snippet, last_activity_at, created_at";
const ORDER_COLS =
  "shopify_id, order_number, total_price, currency, financial_status, fulfillment_status, cancelled_at, confirmation_status, line_items, shopify_created_at";

type WaContactWithShop = CtxWaContact & { shopify_customer_id: string | null };

export async function GET(req: NextRequest) {
  const key = new URL(req.url).searchParams.get("key") || "";
  const channel = key.slice(0, 2);
  const id = key.slice(3);
  if ((channel !== "wa" && channel !== "em") || key[2] !== "-" || !UUID.test(id)) {
    return NextResponse.json({ error: "key must be wa-<id> or em-<id>" }, { status: 400 });
  }

  let waContact: WaContactWithShop | null = null;
  let waThread: CtxWaThread | null = null;
  let email: string | null = null;
  let fallbackName = "Customer";
  let crm: CtxCrmContact | null = null;

  if (channel === "wa") {
    const { data, error } = await supabaseAdmin
      .from("wa_threads")
      .select(`${WA_THREAD_COLS}, contact:wa_contacts!inner(${WA_CONTACT_COLS})`)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { contact, ...thread } = data as unknown as CtxWaThread & { contact: WaContactWithShop };
    waThread = thread;
    waContact = contact;
    email = contact.email || null;
    fallbackName = contact.name || contact.phone || "WhatsApp chat";
    crm = (await findCrmContactForWa({
      email,
      wa_id: contact.wa_id,
      phone: contact.phone,
      shopify_customer_id: contact.shopify_customer_id,
    })) as CtxCrmContact | null;
    email = email || crm?.email || null;
  } else {
    const { data, error } = await supabaseAdmin
      .from("email_threads")
      .select("id, from_email, from_name")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    email = String(data.from_email || "").trim().toLowerCase() || null;
    fallbackName = data.from_name?.trim() || data.from_email;
    if (email) {
      crm = (await findCrmContactForWa({ email })) as CtxCrmContact | null;
      const lite = await findWaContactForCrm({ id: crm?.id, email, phone: crm?.phone ?? null });
      if (lite) {
        const { data: wc } = await supabaseAdmin.from("wa_contacts").select(WA_CONTACT_COLS).eq("wa_id", lite.wa_id).maybeSingle();
        waContact = (wc as WaContactWithShop | null) ?? null;
      }
      if (waContact) {
        const { data: th } = await supabaseAdmin
          .from("wa_threads")
          .select(WA_THREAD_COLS)
          .eq("wa_id", waContact.wa_id)
          .order("last_activity_at", { ascending: false, nullsFirst: false })
          .limit(1);
        waThread = ((th?.[0] ?? null) as CtxWaThread | null) ?? null;
      }
    }
  }

  const waId = waContact?.wa_id || (phoneKey(crm?.phone).length === 10 ? `91${phoneKey(crm?.phone)}` : null);

  // Orders by WhatsApp number and/or email (same keys the contact page uses).
  const ors: string[] = [];
  if (waId) ors.push(`customer_phone.eq.${waId}`);
  if (email && SAFE_EMAIL.test(email)) ors.push(`customer_email.eq.${email}`);

  const emailVariants = email ? Array.from(new Set([email, email.toLowerCase()])) : [];

  const [ordersRes, emailsRes, msgsRes] = await Promise.all([
    ors.length
      ? supabaseAdmin
          .from("shopify_orders")
          .select(ORDER_COLS)
          .or(ors.join(","))
          .order("shopify_created_at", { ascending: false })
          .limit(ORDER_FETCH_LIMIT)
      : Promise.resolve({ data: [] as CtxOrderRow[], error: null }),
    emailVariants.length
      ? supabaseAdmin
          .from("email_threads")
          .select("id, subject, status, lead_category, created_at")
          .in("from_email", emailVariants)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] as CtxEmailThread[], error: null }),
    // A short WhatsApp excerpt only when the open conversation is an email:
    // for a WhatsApp chat the middle column already shows every message.
    channel === "em" && waThread
      ? supabaseAdmin
          .from("wa_messages")
          .select("direction, body, type, created_at")
          .eq("thread_id", waThread.id)
          .order("created_at", { ascending: false })
          .limit(4)
      : Promise.resolve({ data: [] as CtxWaMessage[], error: null }),
  ]);

  const ctx = buildContext({
    open: { channel, id },
    fallbackName,
    email,
    waContact,
    waThread,
    waMessages: ((msgsRes.data ?? []) as CtxWaMessage[]).slice().reverse(),
    crm,
    orders: (ordersRes.data ?? []) as CtxOrderRow[],
    emails: (emailsRes.data ?? []) as CtxEmailThread[],
    storeHandle: STORE_HANDLE || undefined,
  });

  return NextResponse.json(ctx);
}
