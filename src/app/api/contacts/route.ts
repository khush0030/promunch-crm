import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const tag = searchParams.get('tag') || '';
  const minOrders = parseInt(searchParams.get('minOrders') || '0');
  const maxOrders = parseInt(searchParams.get('maxOrders') || '0');
  const minLtv = parseFloat(searchParams.get('minLtv') || '0');
  const maxLtv = parseFloat(searchParams.get('maxLtv') || '0');
  const lastOrderDays = parseInt(searchParams.get('lastOrderDays') || '0');
  const lastOrderOp = searchParams.get('lastOrderOp') || 'within';
  const sort = searchParams.get('sort') || 'created_at';
  const dir = (searchParams.get('dir') || 'desc') === 'asc' ? true : false;

  const allowedSorts = new Set([
    'created_at',
    'total_orders',
    'total_spent',
    'average_order_value',
    'last_purchase_date',
    'first_purchase_date',
    'email',
  ]);
  const sortCol = allowedSorts.has(sort) ? sort : 'created_at';

  const offset = (page - 1) * limit;

  let query = supabase
    .from('contacts')
    .select('*', { count: 'exact' })
    .order(sortCol, { ascending: dir, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
  }

  if (status && status !== 'All') {
    query = query.eq('status', status.toLowerCase());
  }

  if (tag) {
    query = query.contains('tags', [tag]);
  }

  if (minOrders > 0) query = query.gte('total_orders', minOrders);
  if (maxOrders > 0) query = query.lte('total_orders', maxOrders);
  if (minLtv > 0) query = query.gte('total_spent', minLtv);
  if (maxLtv > 0) query = query.lte('total_spent', maxLtv);

  if (lastOrderDays > 0) {
    const cutoff = new Date(Date.now() - lastOrderDays * 24 * 60 * 60 * 1000).toISOString();
    if (lastOrderOp === 'within') {
      query = query.gte('last_purchase_date', cutoff);
    } else if (lastOrderOp === 'before') {
      query = query.lt('last_purchase_date', cutoff);
    }
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    contacts: data || [],
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const {
    email,
    first_name,
    last_name,
    phone,
    shopify_customer_id,
    tags,
    status = 'active',
    source = 'manual',
    city,
    state,
    country,
  } = body;

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      email,
      first_name,
      last_name,
      phone,
      shopify_customer_id,
      tags,
      status,
      source,
      city,
      state,
      country,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact: data }, { status: 201 });
}
