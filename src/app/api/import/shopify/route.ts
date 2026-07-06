import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

// Sync CRM contacts from the shopify_orders table (fed live by the
// shopify-webhook edge function). This is the "Import from Shopify" action on
// /dashboard/contacts — it needs no Shopify API credentials because it reads
// order data we already hold. The full Shopify customer-base sweep (including
// customers with zero orders) is the shopify-contacts-backfill edge function.
//
// Idempotent: upserts on email, stats merged with max() so a re-run or a
// fuller backfill can never shrink a contact's numbers.

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type OrderRow = {
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_price: number | null;
  shopify_created_at: string | null;
};

type Agg = {
  email: string;
  name: string | null;
  phone: string | null;
  count: number;
  spent: number;
  first: string | null;
  last: string | null;
};

export async function POST() {
  // 1. Page through every order we hold.
  const orders: OrderRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('shopify_orders')
      .select('customer_email, customer_name, customer_phone, total_price, shopify_created_at')
      .order('shopify_created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    orders.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }

  // 2. Aggregate per email.
  const byEmail = new Map<string, Agg>();
  let skippedNoEmail = 0;
  for (const o of orders) {
    const email = String(o.customer_email || '').trim().toLowerCase();
    if (!email) { skippedNoEmail++; continue; }
    const agg = byEmail.get(email) ?? {
      email, name: null, phone: null, count: 0, spent: 0, first: null, last: null,
    };
    agg.count += 1;
    agg.spent += Number(o.total_price) || 0;
    if (o.customer_name) agg.name = o.customer_name;
    if (o.customer_phone) agg.phone = o.customer_phone;
    const at = o.shopify_created_at;
    if (at) {
      if (!agg.first || at < agg.first) agg.first = at;
      if (!agg.last || at > agg.last) agg.last = at;
    }
    byEmail.set(email, agg);
  }

  // 3. Load the existing contact rows for those emails (batched .in()).
  const emails = [...byEmail.keys()];
  type Existing = {
    email: string; first_name: string | null; last_name: string | null;
    phone: string | null; status: string | null; source: string | null;
    total_orders: number | null; total_spent: number | null;
    first_purchase_date: string | null; last_purchase_date: string | null;
  };
  const existing = new Map<string, Existing>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data, error } = await supabase
      .from('contacts')
      .select('email, first_name, last_name, phone, status, source, total_orders, total_spent, first_purchase_date, last_purchase_date')
      .in('email', emails.slice(i, i + 200));
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    for (const c of data || []) existing.set(String(c.email).toLowerCase(), c as Existing);
  }

  // 4. Build merged upsert rows.
  const rows = emails.map((email) => {
    const a = byEmail.get(email)!;
    const e = existing.get(email);
    const nameParts = (a.name || '').trim().split(/\s+/).filter(Boolean);
    const totalOrders = Math.max(e?.total_orders ?? 0, a.count);
    const totalSpent = Math.max(Number(e?.total_spent) || 0, Math.round(a.spent * 100) / 100);
    return {
      email,
      first_name: e?.first_name ?? nameParts[0] ?? null,
      last_name: e?.last_name ?? (nameParts.slice(1).join(' ') || null),
      phone: e?.phone ?? a.phone,
      source: e?.source ?? 'shopify',
      status: e?.status ?? 'active',
      total_orders: totalOrders,
      total_spent: totalSpent,
      average_order_value: totalOrders > 0 ? Math.round((totalSpent / totalOrders) * 100) / 100 : 0,
      first_purchase_date: [e?.first_purchase_date, a.first].filter(Boolean).sort()[0] ?? null,
      last_purchase_date: [e?.last_purchase_date, a.last].filter(Boolean).sort().pop() ?? null,
    };
  });

  // 5. Upsert in batches.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from('contacts')
      .upsert(rows.slice(i, i + 200), { onConflict: 'email' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanned: orders.length,
    imported: emails.filter((e) => !existing.has(e)).length,
    updated: emails.filter((e) => existing.has(e)).length,
    skippedNoEmail,
  });
}
