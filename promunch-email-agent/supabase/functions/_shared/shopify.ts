// Shopify webhook HMAC verification + Slack block builder for orders.

async function hmacMatches(rawBody: string, headerHmac: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  // constant-time compare
  if (computed.length !== headerHmac.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ headerHmac.charCodeAt(i);
  return diff === 0;
}

// Shopify signs a webhook with the API secret of the APP THAT REGISTERED IT, not
// with one store-wide secret. This store has webhooks from more than one source:
// the long-standing orders/* subscriptions (signed with SHOPIFY_WEBHOOK_SECRET)
// and the checkouts/* subscriptions registered through the client-credentials
// app by shopify-webhooks-ensure (signed with SHOPIFY_CLIENT_SECRET).
//
// Verifying against only one of those silently 401s the other — and a rejected
// webhook leaves no trace anywhere, which is the failure mode that hid the
// broken cart pipeline for weeks. So accept a match against ANY configured
// secret. This does not weaken the check: each candidate is still a full
// constant-time HMAC verification, and an attacker must forge one of them.
export async function verifyShopifyHmac(
  rawBody: string,
  headerHmac: string | null,
  secret: string,
  extraSecrets: (string | undefined | null)[] = [],
): Promise<boolean> {
  if (!headerHmac) return false;
  const candidates = [secret, ...extraSecrets].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  for (const c of candidates) {
    if (await hmacMatches(rawBody, headerHmac, c)) return true;
  }
  return false;
}

export function fmtMoney(amount: number, currency = "INR"): string {
  const sym = currency === "INR" ? "₹" : currency + " ";
  return sym + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type LineItem = { name?: string; title?: string; quantity?: number; price?: string; variant_title?: string | null };

export function buildOrderBlocks(order: {
  order_number: string;
  total_price: number;
  currency: string;
  customer_name?: string | null;
  customer_email?: string | null;
  line_items: LineItem[];
  financial_status?: string | null;
  prior_orders?: number;
  big_order?: boolean;
  source?: string | null;
}): unknown[] {
  const itemLines = order.line_items.map((li) => {
    const name = li.title || li.name || "Item";
    const variant = li.variant_title ? ` — ${li.variant_title}` : "";
    const qty = li.quantity ?? 1;
    return `• ${qty} × ${name}${variant}`;
  }).join("\n") || "_no items_";

  const who = [order.customer_name, order.customer_email].filter(Boolean).join(" · ") || "_guest_";
  const status = order.financial_status ? ` · ${order.financial_status}` : "";

  const badges: string[] = [];
  // Source tag first so it's the most prominent thing under the header.
  if (order.source) badges.push(order.source);
  if (order.prior_orders === 0) badges.push("🎉 First order");
  else if (order.prior_orders && order.prior_orders > 0) badges.push(`🔁 Order #${order.prior_orders + 1} from customer`);
  if (order.big_order) badges.push("💰 Big order");

  const header = `${order.big_order ? "💰" : "🛒"} New order ${order.order_number}`;
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: header } },
  ];
  if (badges.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: badges.join("  ·  ") }] });
  }
  blocks.push(
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total*\n${fmtMoney(order.total_price, order.currency)}${status}` },
        { type: "mrkdwn", text: `*Customer*\n${who}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Items*\n${itemLines}` } },
  );
  return blocks;
}

export async function postSlackBlocks(channel: string, blocks: unknown[], text: string, threadTs?: string): Promise<string> {
  // Single-bot ("Maya"): all Slack posts use the one app token. Channels route, not bots.
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) throw new Error("SLACK_BOT_TOKEN missing");
  const body: Record<string, unknown> = { channel, blocks, text };
  if (threadTs) body.thread_ts = threadTs;
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Slack postMessage failed: ${j.error}`);
  return j.ts as string;
}
