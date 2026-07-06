import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

// Sync CRM contacts from the shopify_orders table (fed live by the
// shopify-webhook edge function). This is the "Import from Shopify" action on
// /dashboard/contacts — it needs no Shopify API credentials because it reads
// order data we already hold. The full Shopify customer-base sweep (including
// customers with zero orders) is the shopify-contacts-backfill edge function.
//
// IDENTITY: ~93% of orders (HYPD marketplace / guest checkout) have a phone
// but no email. Buyers with an email upsert on email; phone-only buyers match
// on normalized phone (migration 007 made contacts.email nullable).
//
// Idempotent: stats merged with max() so a re-run or a fuller backfill can
// never shrink a contact's numbers.

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
  email: string | null;
  phone: string | null; // bare wa_id digits, e.g. 9198xxxxxx
  name: string | null;
  count: number;
  spent: number;
  first: string | null;
  last: string | null;
};

// canonical form for matching phones across formats (+91…, 91…, bare 10-digit)
const last10 = (p: string | null | undefined) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
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

  // 2. Aggregate per identity: email wins, else phone.
  const byKey = new Map<string, Agg>();
  let skippedNoIdentity = 0;
  for (const o of orders) {
    const email = String(o.customer_email || '').trim().toLowerCase() || null;
    const phone10 = last10(o.customer_phone);
    const key = email ?? (phone10 ? `phone:${phone10}` : '');
    if (!key) { skippedNoIdentity++; continue; }
    const agg = byKey.get(key) ?? {
      email, phone: null, name: null, count: 0, spent: 0, first: null, last: null,
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
    byKey.set(key, agg);
  }

  // 3. Load existing contacts for those identities (batched).
  type Existing = {
    id: string; email: string | null; first_name: string | null;
    last_name: string | null; phone: string | null; status: string | null;
    source: string | null; total_orders: number | null; total_spent: number | null;
    first_purchase_date: string | null; last_purchase_date: string | null;
  };
  const SELECT = 'id, email, first_name, last_name, phone, status, source, total_orders, total_spent, first_purchase_date, last_purchase_date';

  const emails = [...byKey.values()].map((a) => a.email).filter(Boolean) as string[];
  const byEmail = new Map<string, Existing>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data, error } = await supabase.from('contacts').select(SELECT).in('email', emails.slice(i, i + 200));
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    for (const c of (data || []) as Existing[]) byEmail.set(String(c.email).toLowerCase(), c);
  }

  const phoneKeys = [...byKey.keys()].filter((k) => k.startsWith('phone:'));
  const byPhone = new Map<string, Existing>();
  for (let i = 0; i < phoneKeys.length; i += 60) {
    const variants = phoneKeys.slice(i, i + 60).flatMap((k) => {
      const p10 = k.slice(6);
      return [p10, `91${p10}`, `+91${p10}`];
    });
    const { data, error } = await supabase.from('contacts').select(SELECT).in('phone', variants);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    for (const c of (data || []) as Existing[]) {
      const p10 = last10(c.phone);
      if (p10 && !byPhone.has(p10)) byPhone.set(p10, c);
    }
  }

  // 4. Build merged rows and write.
  let imported = 0;
  let updated = 0;
  const emailUpserts: Record<string, unknown>[] = [];

  for (const [key, a] of byKey) {
    const e = a.email ? byEmail.get(a.email) : byPhone.get(key.slice(6));
    const nameParts = (a.name || '').trim().split(/\s+/).filter(Boolean);
    const totalOrders = Math.max(e?.total_orders ?? 0, a.count);
    const totalSpent = Math.max(Number(e?.total_spent) || 0, Math.round(a.spent * 100) / 100);
    const row: Record<string, unknown> = {
      email: a.email ?? e?.email ?? null,
      first_name: e?.first_name ?? nameParts[0] ?? null,
      last_name: e?.last_name ?? (nameParts.slice(1).join(' ') || null),
      phone: e?.phone ?? (a.phone ? `+${String(a.phone).replace(/\D/g, '')}` : null),
      source: e?.source ?? 'shopify',
      status: e?.status ?? 'active',
      total_orders: totalOrders,
      total_spent: totalSpent,
      average_order_value: totalOrders > 0 ? Math.round((totalSpent / totalOrders) * 100) / 100 : 0,
      first_purchase_date: [e?.first_purchase_date, a.first].filter(Boolean).sort()[0] ?? null,
      last_purchase_date: [e?.last_purchase_date, a.last].filter(Boolean).sort().pop() ?? null,
    };

    if (a.email) {
      emailUpserts.push(row);
      if (e) updated++; else imported++;
    } else if (e) {
      const { error } = await supabase.from('contacts').update(row).eq('id', e.id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      updated++;
    } else {
      const { error } = await supabase.from('contacts').insert(row);
      if (error && error.code !== '23505') {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      imported++;
    }
  }

  for (let i = 0; i < emailUpserts.length; i += 200) {
    const { error } = await supabase
      .from('contacts')
      .upsert(emailUpserts.slice(i, i + 200), { onConflict: 'email' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanned: orders.length,
    imported,
    updated,
    skippedNoEmail: skippedNoIdentity,
  });
}
