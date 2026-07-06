import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

// CSV export of the contact list, honouring the same filters as GET
// /api/contacts (filter logic intentionally mirrored — keep the two in sync).
// Capped at 20k rows; paged in 1k chunks (PostgREST per-request limit).

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const COLUMNS = [
  'email', 'first_name', 'last_name', 'phone', 'status', 'source',
  'total_orders', 'total_spent', 'average_order_value',
  'first_purchase_date', 'last_purchase_date',
  'city', 'state', 'country', 'tags', 'created_at',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const tag = searchParams.get('tag') || '';
  const list = searchParams.get('list') || '';
  const segment = searchParams.get('segment') || '';
  const minOrders = parseInt(searchParams.get('minOrders') || '0');
  const minLtv = parseFloat(searchParams.get('minLtv') || '0');
  const lastOrderDays = parseInt(searchParams.get('lastOrderDays') || '0');
  const lastOrderOp = searchParams.get('lastOrderOp') || 'within';

  const CAP = 20000;
  const PAGE = 1000;
  const lines = [COLUMNS.join(',')];

  for (let from = 0; from < CAP; from += PAGE) {
    let query = supabase
      .from('contacts')
      .select(COLUMNS.join(','))
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);

    if (search) {
      const safe = search.replace(/[,()."\\]/g, ' ').trim();
      if (safe) {
        query = query.or(`email.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,phone.ilike.%${safe}%`);
      }
    }
    if (status && status !== 'All') query = query.eq('status', status.toLowerCase());
    if (tag) query = query.contains('tags', [tag]);
    if (list) query = query.contains('klaviyo_lists', [list]);
    if (segment) query = query.contains('klaviyo_segments', [segment]);
    if (minOrders > 0) query = query.gte('total_orders', minOrders);
    if (minLtv > 0) query = query.gte('total_spent', minLtv);
    if (lastOrderDays > 0) {
      const cutoff = new Date(Date.now() - lastOrderDays * 24 * 60 * 60 * 1000).toISOString();
      query = lastOrderOp === 'before'
        ? query.lt('last_purchase_date', cutoff)
        : query.gte('last_purchase_date', cutoff);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    for (const row of (data || []) as unknown as Record<string, unknown>[]) {
      lines.push(COLUMNS.map((c) => csvCell(row[c])).join(','));
    }
    if (!data || data.length < PAGE) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="contacts-${stamp}.csv"`,
    },
  });
}
