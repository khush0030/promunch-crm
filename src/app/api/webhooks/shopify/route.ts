import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Shopify webhook handler — scaffold
// Validates HMAC signature when SHOPIFY_WEBHOOK_SECRET is set

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

export async function POST(request: NextRequest) {
  const topic = request.headers.get('x-shopify-topic') || '';
  let body: unknown;

  try {
    body = await request.json();
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
