import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: contact, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('contact_id', id)
    .order('placed_at', { ascending: false });

  const { data: emailHistory } = await supabase
    .from('email_events')
    .select('*, campaign_emails(*, campaigns(name, subject))')
    .eq('contact_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({
    contact,
    orders: orders || [],
    emailHistory: emailHistory || [],
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const allowedFields = [
    'email', 'first_name', 'last_name', 'phone',
    'tags', 'status', 'city', 'state', 'country',
    'shopify_customer_id',
  ];

  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      updateData[field] = body[field];
    }
  }

  const { data, error } = await supabase
    .from('contacts')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact: data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { error } = await supabase
    .from('contacts')
    .update({ status: 'inactive' })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
