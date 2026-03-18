import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = (page - 1) * limit;

  let query = supabase
    .from('campaigns')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status !== 'All') {
    query = query.eq('status', status.toLowerCase());
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    campaigns: data || [],
    total: count || 0,
    page,
    limit,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const {
    name,
    subject,
    preview_text,
    body_html,
    status = 'draft',
    segment_filter,
    scheduled_at,
  } = body;

  if (!name) {
    return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      name,
      subject,
      preview_text,
      body_html,
      status,
      segment_filter,
      scheduled_at,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaign: data }, { status: 201 });
}
