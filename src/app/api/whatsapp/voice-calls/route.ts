import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Call log: either scoped to one WhatsApp number (Inbox customer panel,
// ?wa_id=...) or the full list for the Voice tab (filters + enrichment).
//
// The Inbox panel has depended on the plain {calls:[...]} shape and a 50-row
// default since before this tab existed — that path is left byte-for-byte
// compatible (same default limit, same base columns present) and just gets a
// few extra fields tacked on for free, which the panel's local VoiceCall type
// simply ignores.
//
// Efficiency note: every lookup below (wa_contacts, CRM contacts, journey
// runs, shopify_orders) is ONE query with an .in()/.or() over the whole page
// of calls, never a query per row.

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || "";
const STORE_HANDLE = SHOPIFY_STORE_URL.replace(/\.myshopify\.com$/i, "");

function adminOrderUrl(shopifyId: string | number | null | undefined): string | null {
  return STORE_HANDLE && shopifyId ? `https://admin.shopify.com/store/${STORE_HANDLE}/orders/${shopifyId}` : null;
}

function phoneKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(-10);
}

type CallRow = {
  id: string;
  run_id: string | null;
  wa_id: string;
  order_ref: string | null;
  attempt_id: string | null;
  interaction_id: string | null;
  status: string;
  outcome: string | null;
  duration_s: number | null;
  failure_reason: string | null;
  transcript: unknown;
  link_sent_at: string | null;
  created_at: string;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const waId = sp.get("wa_id");
  const statusFilter = sp.get("status");
  const outcomeFilter = sp.get("outcome");
  const search = (sp.get("q") ?? "").trim().toLowerCase();

  const requestedLimit = Number(sp.get("limit"));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(200, Math.floor(requestedLimit))
    : (waId ? 50 : 100); // preserve the Inbox panel's original default of 50
  // A text search happens in-memory below (it needs the resolved contact
  // name, which is a batched lookup, not a column on voice_calls) so pull a
  // wider candidate set first and narrow after enrichment, still one query.
  const fetchLimit = search ? Math.min(500, limit * 5) : limit;

  let query = supabaseAdmin
    .from("voice_calls")
    .select("id, run_id, wa_id, order_ref, attempt_id, interaction_id, status, outcome, duration_s, failure_reason, transcript, link_sent_at, created_at")
    .order("created_at", { ascending: false })
    .limit(fetchLimit);
  if (waId) query = query.eq("wa_id", waId.replace(/\D/g, ""));
  if (statusFilter) query = query.eq("status", statusFilter);
  if (outcomeFilter) query = query.eq("outcome", outcomeFilter);

  const { data: callRows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const calls = (callRows ?? []) as CallRow[];

  if (calls.length === 0) {
    return NextResponse.json({ calls: [], stats: { placed: 0, connected: 0, linkSent: 0, doNotCall: 0, dialing: 0 } });
  }

  const waIds = Array.from(new Set(calls.map((c) => c.wa_id).filter(Boolean)));
  const runIds = Array.from(new Set(calls.map((c) => c.run_id).filter((x): x is string => !!x)));

  // --- batch 1: wa_contacts -------------------------------------------------
  const { data: waContactRows } = waIds.length
    ? await supabaseAdmin.from("wa_contacts")
        .select("wa_id, name, phone, email, voice_dnd, shopify_customer_id")
        .in("wa_id", waIds)
    : { data: [] as never[] };
  const waContactByWaId = new Map<string, { wa_id: string; name: string | null; phone: string | null; email: string | null; voice_dnd: boolean; shopify_customer_id: string | null }>();
  for (const w of waContactRows ?? []) waContactByWaId.set(w.wa_id, w);

  // --- batch 2: CRM contacts (shopify_customer_id -> email -> phone) --------
  // Mirrors findCrmContactForWa's match priority (src/lib/customer-link.ts)
  // but batched across every wa_id on the page instead of one query per row.
  const CRM_FIELDS = "id, email, phone, shopify_customer_id";
  const scIds = Array.from(new Set((waContactRows ?? []).map((w) => w.shopify_customer_id).filter((x): x is string => !!x)));
  const emails = Array.from(new Set((waContactRows ?? []).map((w) => w.email).filter((x): x is string => !!x)));
  const phoneKeys = Array.from(new Set(waIds.map((id) => {
    const w = waContactByWaId.get(id);
    return phoneKey(w?.phone || id);
  }).filter(Boolean)));

  const crmById = new Map<string, string>(); // shopify_customer_id -> contact id
  const crmByEmail = new Map<string, string>(); // lowercased email -> contact id
  const crmByPhoneKey = new Map<string, string>(); // last-10-digits -> contact id

  if (scIds.length) {
    const { data } = await supabaseAdmin.from("contacts").select(CRM_FIELDS).in("shopify_customer_id", scIds);
    for (const c of data ?? []) if (c.shopify_customer_id) crmById.set(c.shopify_customer_id, c.id);
  }
  if (emails.length) {
    const { data } = await supabaseAdmin.from("contacts").select(CRM_FIELDS)
      .or(emails.map((e) => `email.ilike.${e}`).join(","));
    for (const c of data ?? []) if (c.email) crmByEmail.set(c.email.toLowerCase(), c.id);
  }
  if (phoneKeys.length) {
    const { data } = await supabaseAdmin.from("contacts").select(CRM_FIELDS)
      .or(phoneKeys.map((k) => `phone.ilike.%${k}%`).join(","));
    for (const c of data ?? []) {
      const k = phoneKey(c.phone);
      if (k) crmByPhoneKey.set(k, c.id);
    }
  }

  function resolveCrmContactId(waId2: string): string | null {
    const w = waContactByWaId.get(waId2);
    if (w?.shopify_customer_id && crmById.has(w.shopify_customer_id)) return crmById.get(w.shopify_customer_id)!;
    if (w?.email && crmByEmail.has(w.email.toLowerCase())) return crmByEmail.get(w.email.toLowerCase())!;
    const key = phoneKey(w?.phone || waId2);
    if (key && crmByPhoneKey.has(key)) return crmByPhoneKey.get(key)!;
    return null;
  }

  // --- batch 3: wa_journey_runs ---------------------------------------------
  const { data: runRows } = runIds.length
    ? await supabaseAdmin.from("wa_journey_runs").select("id, status, order_ref, delivered_at, context").in("id", runIds)
    : { data: [] as never[] };
  const runById = new Map<string, { id: string; status: string; order_ref: string | null; delivered_at: string | null; context: unknown }>();
  for (const r of runRows ?? []) runById.set(r.id, r);

  // --- batch 4: shopify_orders (candidate "likely order after the call") ---
  // No usable checkout token on real orders (1-click checkout bypasses native
  // checkout), so linkage is by phone + time window only — see the rule
  // below. This is presentation, never proof: label it "likely order after
  // the call" in the UI, never "caused by".
  const { data: orderRows } = waIds.length
    ? await supabaseAdmin.from("shopify_orders")
        .select("shopify_id, order_number, total_price, financial_status, customer_phone, shopify_created_at")
        .in("customer_phone", waIds)
        .order("shopify_created_at", { ascending: true })
    : { data: [] as never[] };
  const ordersByPhone = new Map<string, Array<{ shopify_id: string; order_number: number; total_price: number; financial_status: string | null; shopify_created_at: string }>>();
  for (const o of orderRows ?? []) {
    const arr = ordersByPhone.get(o.customer_phone) ?? [];
    arr.push(o);
    ordersByPhone.set(o.customer_phone, arr);
  }

  const SEVENTY_TWO_HOURS_MS = 72 * 3600_000;
  function likelyOrderAfterCall(call: CallRow) {
    const candidates = ordersByPhone.get(call.wa_id);
    if (!candidates?.length) return null;
    const callTime = new Date(call.created_at).getTime();
    for (const o of candidates) { // ascending order -> first match is earliest
      const t = new Date(o.shopify_created_at).getTime();
      if (t > callTime && t - callTime <= SEVENTY_TWO_HOURS_MS) {
        return {
          order_number: o.order_number,
          total_price: o.total_price,
          financial_status: o.financial_status,
          admin_url: adminOrderUrl(o.shopify_id),
        };
      }
    }
    return null;
  }

  // --- assemble --------------------------------------------------------------
  const enriched = calls.map((c) => {
    const wc = waContactByWaId.get(c.wa_id) ?? null;
    const run = c.run_id ? runById.get(c.run_id) ?? null : null;
    const ctx = (run?.context ?? {}) as Record<string, unknown>;
    const vars = (ctx.vars ?? {}) as Record<string, string>;
    return {
      id: c.id,
      wa_id: c.wa_id,
      order_ref: c.order_ref,
      attempt_id: c.attempt_id,
      interaction_id: c.interaction_id,
      status: c.status,
      outcome: c.outcome,
      duration_s: c.duration_s,
      failure_reason: c.failure_reason,
      transcript: c.transcript,
      link_sent_at: c.link_sent_at,
      created_at: c.created_at,
      has_recording: !!c.interaction_id,
      contact: { wa_id: c.wa_id, name: wc?.name ?? null, phone: wc?.phone ?? null, voice_dnd: wc?.voice_dnd ?? false },
      crm_contact_id: resolveCrmContactId(c.wa_id),
      run: run ? {
        id: run.id,
        status: run.status,
        order_ref: run.order_ref,
        delivered_at: run.delivered_at,
        cart_total: typeof ctx.total === "number" ? ctx.total : (ctx.total != null ? Number(ctx.total) : null),
        cart_items: Array.isArray(ctx.items) ? ctx.items : [],
        checkout_url: vars["2"] ?? null,
      } : null,
      order: likelyOrderAfterCall(c),
    };
  });

  // A search term that looks like a phone number (spaces, +, dashes) is
  // matched against the digits-only wa_id by its digits alone, so "+91
  // 98765" finds the same row as "9198765".
  const searchDigits = search.replace(/\D/g, "");
  const filtered = search
    ? enriched.filter((c) =>
        (searchDigits.length > 0 && c.wa_id.includes(searchDigits)) ||
        (c.contact.name ?? "").toLowerCase().includes(search),
      )
    : enriched;

  const stats = {
    placed: filtered.length,
    connected: filtered.filter((c) => c.status === "connected").length,
    linkSent: filtered.filter((c) => !!c.link_sent_at).length,
    doNotCall: filtered.filter((c) => c.contact.voice_dnd).length,
    dialing: filtered.filter((c) => c.status === "dialing").length,
  };

  return NextResponse.json({ calls: filtered.slice(0, limit), stats });
}
