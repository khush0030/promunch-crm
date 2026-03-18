// Shopify integration scaffold
// Requires SHOPIFY_ACCESS_TOKEN to be set with a real Admin API token

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

const shopifyApiBase = `https://${SHOPIFY_STORE_URL}/admin/api/2024-01`;

async function shopifyFetch(endpoint: string) {
  if (!SHOPIFY_ACCESS_TOKEN || SHOPIFY_ACCESS_TOKEN === 'placeholder_needs_real_token') {
    throw new Error('Shopify Admin API token not configured. Set SHOPIFY_ACCESS_TOKEN in environment variables.');
  }

  const response = await fetch(`${shopifyApiBase}${endpoint}`, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function fetchCustomers(limit = 250, page_info?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (page_info) params.set('page_info', page_info);
  return shopifyFetch(`/customers.json?${params}`);
}

export async function fetchOrders(limit = 250, page_info?: string) {
  const params = new URLSearchParams({ limit: String(limit), status: 'any' });
  if (page_info) params.set('page_info', page_info);
  return shopifyFetch(`/orders.json?${params}`);
}

export async function fetchCustomer(customerId: string) {
  return shopifyFetch(`/customers/${customerId}.json`);
}

export async function fetchCustomerOrders(customerId: string) {
  return shopifyFetch(`/customers/${customerId}/orders.json?status=any`);
}
