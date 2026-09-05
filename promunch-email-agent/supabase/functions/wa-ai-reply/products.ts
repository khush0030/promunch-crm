// lookup_product tool: search the wa_catalog_items mirror (filled every 30 min
// by shopify-catalog-sync) and render a compact tool result with exact titles,
// prices, stock and promunch.in URLs. The model may only send URLs from here.

const STORE_URL = (Deno.env.get("SHOPIFY_PUBLIC_STORE_URL") ?? "https://promunch.in").replace(/\/$/, "");

interface Row {
  retailer_id: string;
  title: string;
  product_title: string | null;
  variant_title: string | null;
  category: string | null;
  price_inr: number | null;
  compare_at_inr: number | null;
  in_stock: boolean;
  inventory_quantity: number | null;
  handle: string | null;
  product_url: string | null;
  image_url: string | null;
  tags: string[] | null;
}

// One product ready to send as an image + button card.
export interface ProductCard {
  title: string;
  price: number | null;
  url: string;
  image: string | null;
}

export async function lookupProducts(
  sb: any,
  query: string,
  inStockOnly = true,
): Promise<{ text: string; cards: ProductCard[] }> {
  const q = (query ?? "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").trim();
  const terms = q.split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));

  let sel = sb
    .from("wa_catalog_items")
    .select("retailer_id,title,product_title,variant_title,category,price_inr,compare_at_inr,in_stock,inventory_quantity,handle,product_url,image_url,tags")
    .order("sort", { ascending: true })
    .limit(200);
  if (inStockOnly) sel = sel.eq("in_stock", true);
  const { data, error } = await sel;
  if (error) return { text: "Product lookup failed. Tell the customer the team will send the link shortly.", cards: [] };
  const rows = (data ?? []) as Row[];
  if (!rows.length) {
    return { text: "The product catalogue is empty right now. Answer from the knowledge base and point them to promunch.in, without inventing a specific URL.", cards: [] };
  }

  // Score: every query term that appears in title / category / tags counts;
  // all-terms match ranks first. No terms (e.g. "menu") returns everything.
  const scored = rows.map((r) => {
    const hay = [r.title, r.product_title, r.category, ...(r.tags ?? [])]
      .filter(Boolean).join(" ").toLowerCase();
    const hits = terms.filter((t) => hay.includes(t)).length;
    return { r, hits, full: terms.length > 0 && hits === terms.length };
  });
  let picked = scored.filter((s) => s.full);
  if (!picked.length) picked = scored.filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits);
  if (!picked.length && terms.length === 0) picked = scored;
  if (!picked.length) {
    const names = uniq(rows.map((r) => r.product_title || r.title)).slice(0, 12).join("; ");
    return {
      text: `No product matches "${query}". We do sell: ${names}. Tell the customer we do not have that and name the closest one from this list.`,
      cards: [],
    };
  }

  // Collapse variants under their product so the model sees one URL per product.
  const byProduct = new Map<string, Row[]>();
  for (const { r } of picked.slice(0, 40)) {
    const key = r.handle || r.product_title || r.title;
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(r);
  }

  const lines: string[] = [];
  const cards: ProductCard[] = [];
  for (const [, variants] of [...byProduct.entries()].slice(0, 6)) {
    const p = variants[0];
    const url = p.product_url || (p.handle ? `${STORE_URL}/products/${p.handle}` : null);
    const stock = variants.some((v) => v.in_stock) ? "in stock" : "out of stock";
    if (url && variants.some((v) => v.in_stock)) {
      cards.push({
        title: p.product_title || p.title,
        price: variants.find((v) => v.in_stock)?.price_inr ?? p.price_inr,
        url,
        image: p.image_url ?? null,
      });
    }
    lines.push(`${p.product_title || p.title} (${stock})${url ? `\nURL: ${url}` : "\nURL: not available, do not invent one"}`);
    for (const v of variants.slice(0, 8)) {
      const price = v.price_inr != null ? `Rs ${fmt(v.price_inr)}` : "price not listed";
      const mrp = v.compare_at_inr != null && v.compare_at_inr > (v.price_inr ?? 0) ? ` (MRP Rs ${fmt(v.compare_at_inr)})` : "";
      const vt = v.variant_title ? `${v.variant_title}: ` : "";
      lines.push(`  - ${vt}${price}${mrp}, ${v.in_stock ? "in stock" : "sold out"}`);
    }
  }
  lines.push(
    "Do NOT paste any of these URLs into your reply. If the customer is ready to see a product, " +
      "call send_product_card with the exact product title, and it goes out as a photo with a Buy button. " +
      "Otherwise just talk about the products in words.",
  );
  return { text: lines.join("\n"), cards };
}

// Resolve one product by title for send_product_card. Exact-ish match on the
// title the model saw in the lookup_product result.
export function pickCard(cards: ProductCard[], title: string): ProductCard | null {
  const want = (title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!want) return cards[0] ?? null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (
    cards.find((c) => norm(c.title) === want) ??
    cards.find((c) => norm(c.title).includes(want) || want.includes(norm(c.title))) ??
    null
  );
}

const STOP = new Set(["the", "a", "an", "of", "for", "and", "link", "please", "pls", "send", "me", "i", "want", "to", "buy", "order", "pack", "packs", "gm", "g", "grams", "gram"]);

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
function uniq(a: string[]): string[] {
  return [...new Set(a.filter(Boolean))];
}
