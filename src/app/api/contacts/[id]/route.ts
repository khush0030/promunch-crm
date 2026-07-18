import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from "@/lib/rbac-server";
import { recordAudit } from "@/lib/audit";
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { parseBody } from '@/lib/api-helpers';

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

  // Order history lives in shopify_orders (fed live by the shopify-webhook
  // edge fn) — the legacy `orders` table stopped filling when the old Next.js
  // webhook died. Match on email, plus normalized phone to catch guest /
  // marketplace orders that arrived without an email.
  const email = String(contact.email || '').trim().toLowerCase();
  const digits = String(contact.phone || '').replace(/\D/g, '');
  const waId = digits.length === 10 ? `91${digits}` : digits;

  const ors: string[] = [];
  if (email) ors.push(`customer_email.eq.${email}`);
  if (waId.length >= 10) ors.push(`customer_phone.eq.${waId}`);

  const { data: shopOrders } = ors.length
    ? await supabase
        .from('shopify_orders')
        .select('id, order_number, total_price, currency, financial_status, line_items, shopify_created_at')
        .or(ors.join(','))
        .order('shopify_created_at', { ascending: false })
        .limit(50)
    : { data: [] };

  type LineItem = { title?: string; quantity?: number };
  const orders = (shopOrders || []).map((o) => {
    const items = (Array.isArray(o.line_items) ? o.line_items : []) as LineItem[];
    return {
      id: o.id,
      order_number: String(o.order_number || '').replace(/^#/, ''),
      total_amount: Number(o.total_price) || 0,
      currency: o.currency || 'INR',
      status: o.financial_status || 'pending',
      products: {
        items: items.map((li) => li.title).filter(Boolean),
        itemCount: items.reduce((n, li) => n + (Number(li.quantity) || 0), 0),
      },
      placed_at: o.shopify_created_at,
    };
  });

  const { data: emailHistory } = await supabase
    .from('email_events')
    .select('*, campaign_emails(*, campaigns(name, subject))')
    .eq('contact_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({
    contact,
    orders,
    emailHistory: emailHistory || [],
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await parseBody(request);
  if (!body) {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const allowedFields = [
    'email', 'first_name', 'last_name', 'phone',
    'tags', 'status', 'city', 'state', 'country',
    'shopify_customer_id', 'accepts_marketing',
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
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const { error } = await supabase
    .from('contacts')
    .update({ status: 'inactive' })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordAudit({
    action: "contact.delete",
    entityType: "contact",
    entityId: id,
    summary: `Deactivated contact ${id}`,
    actor: gate.user,
    request,
  });

  return NextResponse.json({ success: true });
}
