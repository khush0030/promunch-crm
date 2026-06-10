// Shopify webhook HMAC verification + Slack block builder for orders.

export async function verifyShopifyHmac(rawBody: string, headerHmac: string | null, secret: string): Promise<boolean> {
  if (!headerHmac) return false;
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

export async function postSlack(channel: string, blocks: unknown[], text: string, threadTs?: string): Promise<string> {
  const token = Deno.env.get("SHOPIFY_SLACK_BOT_TOKEN");
  if (!token) throw new Error("SHOPIFY_SLACK_BOT_TOKEN missing");
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
