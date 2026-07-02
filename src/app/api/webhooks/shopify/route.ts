import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

// Shopify webhook handler.
// SECURITY (audit C4): verifies the Shopify HMAC signature and FAILS CLOSED —
// if SHOPIFY_WEBHOOK_SECRET is unset or the signature is missing/invalid the
// request is rejected 401. Writes go through the service-role client (this
// endpoint is public; middleware exempts /api/webhooks/*).
//
// NOTE: this route writes to the legacy `contacts`/`orders` tables and largely
// duplicates the Supabase edge function `shopify-webhook` (which writes
// `shopify_orders`). Confirm whether Shopify is actually pointed here before
// relying on it; if not, prefer removing this route.

export const dynamic = 'force-dynamic';

type ShopifyCustomer = {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  default_address?: {
    city?: string;
    province?: string;
    country?: string;
  };
};

type ShopifyOrder = {
  id: number;
  name: string; // order number like #1001
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  customer?: ShopifyCustomer;
  line_items?: Array<{
    title: string;
    quantity: number;
    price: string;
    sku: string;
  }>;
  created_at: string;
};

function mapOrderStatus(financial: string, fulfillment: string | null): string {
  if (financial === 'refunded') return 'refunded';
  if (fulfillment === 'fulfilled') return 'delivered';
  if (fulfillment === 'partial') return 'shipped';
  if (financial === 'paid') return 'confirmed';
  return 'pending';
}

// Shopify signs the raw body: base64(HMAC-SHA256(body, secret)).
function verifyShopifyHmac(rawBody: string, header: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !header) return false; // fail closed
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifyShopifyHmac(rawBody, request.headers.get('x-shopify-hmac-sha256'))) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const topic = request.headers.get('x-shopify-topic') || '';
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  switch (topic) {
    case 'customers/create':
    case 'customers/update': {
      const customer = body as ShopifyCustomer;
      if (!customer.email) break;

      await supabase.from('contacts').upsert({
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
        shopify_customer_id: String(customer.id),
        city: customer.default_address?.city,
        state: customer.default_address?.province,
        country: customer.default_address?.country,
        source: 'shopify',
      }, { onConflict: 'shopify_customer_id' });
      break;
    }

    case 'orders/create':
    case 'orders/updated': {
      const order = body as ShopifyOrder;

      // Upsert contact if customer exists
      let contactId: string | null = null;

      if (order.customer?.email) {
        const { data: contact } = await supabase
          .from('contacts')
          .upsert({
            email: order.customer.email,
            first_name: order.customer.first_name,
            last_name: order.customer.last_name,
            phone: order.customer.phone,
            shopify_customer_id: String(order.customer.id),
            source: 'shopify',
          }, { onConflict: 'email' })
          .select('id')
          .single();

        contactId = contact?.id || null;

        // Update contact order stats
        if (contactId) {
          const { data: allOrders } = await supabase
            .from('orders')
            .select('total_amount')
            .eq('contact_id', contactId);

          const totalSpent = (allOrders || []).reduce((sum, o) => sum + (o.total_amount || 0), 0)
            + parseFloat(order.total_price || '0');
          const totalOrders = (allOrders?.length || 0) + 1;

          await supabase.from('contacts').update({
            total_orders: totalOrders,
            total_spent: totalSpent,
            average_order_value: totalSpent / totalOrders,
            last_purchase_date: order.created_at,
          }).eq('id', contactId);
        }
      }

      // Upsert order
      const products = (order.line_items || []).map((item) => ({
        name: item.title,
        quantity: item.quantity,
        price: parseFloat(item.price),
        sku: item.sku,
      }));

      await supabase.from('orders').upsert({
        contact_id: contactId,
        shopify_order_id: String(order.id),
        order_number: order.name,
        total_amount: parseFloat(order.total_price || '0'),
        currency: order.currency || 'INR',
        status: mapOrderStatus(order.financial_status, order.fulfillment_status),
        products,
        placed_at: order.created_at,
      }, { onConflict: 'shopify_order_id' });

      break;
    }

    case 'checkouts/create':
    case 'checkouts/update': {
      // Scaffold for abandoned cart tracking — would create flow enrollment
      // Full implementation requires real Shopify token + flow automation
      break;
    }

    default:
      // Unknown topic — acknowledge anyway
      break;
  }

  return NextResponse.json({ received: true });
}
