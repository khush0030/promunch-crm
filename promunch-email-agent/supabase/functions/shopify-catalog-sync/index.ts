// Sync the Shopify product catalog → wa_catalog_items (the WhatsApp ordering
// mirror) AND the bot's knowledge base. Triggered manually from the dashboard
// (/api/shopify/catalog) or by cron. Reads ACTIVE products via the Admin
// GraphQL API and upserts one row per variant.
//
// CONVENTION (see docs/WHATSAPP_ORDERING.md): retailer_id = the Shopify variant
// numeric id, which must equal the Meta catalog Content ID. Build your Meta
// catalog with Content ID = variant id (CSV/feed) and this mirror lines up so a
// WhatsApp cart becomes a Shopify checkout link with no product lookups.
//
// The sync OWNS the table: variants it sees → in_stock per Shopify availability;
// any retailer_id it no longer sees → in_stock = false (retired / deleted).
//
// KB BRIDGE: it also rebuilds a generated kb_documents row ("Live Product
// Catalog") from the same live Shopify data and re-embeds it via kb-embed, so
// wa-ai-reply answers product questions ("what do you sell / is X in stock /
// what flavours") from CURRENT Shopify — no manual KB edits. The hand-written
// Master KB still owns nutrition, policies and brand voice.

import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { adminGraphQL } from "../_shared/shopify-customer.ts";

// Stable name for the generated KB doc — we upsert this single row each run.
const KB_DOC_NAME = "Live Product Catalog (auto-synced from Shopify)";

const PRODUCTS_QUERY = `
query CatalogSync($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        title
        handle
        onlineStoreUrl
        featuredImage { url }
        productType
        descriptionPlainText: description(truncateAt: 600)
        tags
        variants(first: 100) {
          edges {
            node {
              id
              title
              price
              compareAtPrice
              sku
              image { url }
              inventoryQuantity
              availableForSale
            }
          }
        }
      }
    }
  }
}`;

const MAX_PAGES = 20; // safety cap (1000 products), plenty for this catalog
// Public storefront for product URLs when Shopify has no onlineStoreUrl
// (custom domain not linked in the API response).
const STORE_URL = (Deno.env.get("SHOPIFY_PUBLIC_STORE_URL") ?? "https://promunch.in").replace(/\/$/, "");
// Copy rule: no em/en dashes in anything the bot may quote.
const noDash = (t: string) => t.replace(/\s+[—–]\s+/g, ", ").replace(/[—–]/g, "-");

function variantNumericId(gid: string): string {
  // gid://shopify/ProductVariant/123456 -> "123456"
  const m = String(gid ?? "").match(/(\d+)\s*$/);
  return m ? m[1] : "";
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return j({ ok: false, error: "method" }, 405);

  const sb = db();
  const rows: Array<{
    retailer_id: string;
    title: string;
    category: string | null;
    price_inr: number | null;
    in_stock: boolean;
    sort: number;
    updated_at: string;
    product_id: string;
    product_title: string;
    variant_title: string;
    handle: string | null;
    product_url: string | null;
    inventory_quantity: number | null;
    compare_at_inr: number | null;
    description: string;
    tags: string[];
    last_synced_at: string;
    image_url: string | null;
    sku: string | null;
  }> = [];

  // Product-level view (for the KB doc) — one entry per Shopify product, with
  // its variants rolled up. The bot reasons over this prose, not the cards.
  const products: Array<{
    title: string;
    url: string | null;
    category: string | null;
    description: string;
    tags: string[];
    variants: Array<{ title: string; price: number | null; inStock: boolean }>;
  }> = [];

  let cursor: string | null = null;
  let pages = 0;
  let sort = 0;
  try {
    do {
      const res = await adminGraphQL(PRODUCTS_QUERY, { cursor });
      if (res?.errors) {
        return j({ ok: false, error: `Shopify GraphQL: ${JSON.stringify(res.errors).slice(0, 300)}` }, 502);
      }
      const conn = res?.data?.products;
      if (!conn) return j({ ok: false, error: "no products in Shopify response" }, 502);

      for (const pe of conn.edges ?? []) {
        const p = pe.node;
        const category = (p.productType ?? "").trim() || null;
        const handle = String(p.handle ?? "").trim() || null;
        const url = String(p.onlineStoreUrl ?? "").trim() || (handle ? `${STORE_URL}/products/${handle}` : null);
        const productId = variantNumericId(String(p.id ?? ""));
        const productImage = String(p.featuredImage?.url ?? "").trim() || null;
        const prod = {
          title: noDash(String(p.title ?? "").trim()),
          url,
          category,
          description: noDash(String(p.descriptionPlainText ?? "").trim()),
          tags: Array.isArray(p.tags) ? p.tags.map((t: string) => String(t).trim()).filter(Boolean) : [],
          variants: [] as Array<{ title: string; price: number | null; inStock: boolean }>,
        };
        for (const ve of p.variants?.edges ?? []) {
          const v = ve.node;
          const retailerId = variantNumericId(v.id);
          if (!retailerId) continue;
          const variantTitle = (v.title ?? "").trim();
          // "Default Title" is Shopify's placeholder for single-variant products
          const title = variantTitle && variantTitle !== "Default Title"
            ? `${p.title} (${variantTitle})`
            : p.title;
          const price = v.price != null ? Number(v.price) : null;
          const compareAt = v.compareAtPrice != null ? Number(v.compareAtPrice) : null;
          const inStock = v.availableForSale === true ||
            (v.availableForSale == null && (v.inventoryQuantity == null || v.inventoryQuantity > 0));
          const nowIso = new Date().toISOString();
          rows.push({
            retailer_id: retailerId,
            title: noDash(String(title)).slice(0, 200),
            category,
            price_inr: Number.isFinite(price as number) ? (price as number) : null,
            in_stock: inStock,
            sort: sort++,
            updated_at: nowIso,
            product_id: productId,
            product_title: prod.title,
            variant_title: variantTitle && variantTitle !== "Default Title" ? noDash(variantTitle) : "",
            handle,
            product_url: url,
            inventory_quantity: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : null,
            compare_at_inr: Number.isFinite(compareAt as number) ? (compareAt as number) : null,
            description: prod.description.slice(0, 600),
            tags: prod.tags,
            last_synced_at: nowIso,
            image_url: String(v.image?.url ?? "").trim() || productImage,
            sku: String(v.sku ?? "").trim() || null,
          });
          prod.variants.push({
            title: variantTitle && variantTitle !== "Default Title" ? variantTitle : "",
            price: Number.isFinite(price as number) ? (price as number) : null,
            inStock,
          });
        }
        if (prod.title) products.push(prod);
      }

      cursor = conn.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
      pages++;
    } while (cursor && pages < MAX_PAGES);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "admin-not-configured") {
      return j({ ok: false, error: "Shopify Admin API not configured (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_STORE_DOMAIN)." }, 400);
    }
    return j({ ok: false, error: msg.slice(0, 300) }, 502);
  }

  if (!rows.length) return j({ ok: true, synced: 0, deactivated: 0, note: "no active variants found" });

  // upsert all variants we saw
  const { error: upErr } = await sb.from("wa_catalog_items").upsert(rows, { onConflict: "retailer_id" });
  if (upErr) return j({ ok: false, error: `upsert failed: ${upErr.message}` }, 500);

  // retire anything Shopify no longer returns (deleted / drafted products)
  const seen = rows.map((r) => r.retailer_id);
  let deactivated = 0;
  const { data: stale } = await sb
    .from("wa_catalog_items")
    .update({ in_stock: false, updated_at: new Date().toISOString() })
    .eq("in_stock", true)
    .not("retailer_id", "in", `(${seen.join(",")})`)
    .select("retailer_id");
  deactivated = stale?.length ?? 0;

  // ---- KB bridge: rebuild the generated "Live Product Catalog" doc + re-embed.
  // Best-effort: a KB failure must never fail the catalog sync itself.
  let kb: { ok: boolean; products: number; error?: string };
  try {
    kb = await syncKbDoc(sb, products);
  } catch (e) {
    kb = { ok: false, products: 0, error: String(e instanceof Error ? e.message : e) };
  }

  return j({ ok: true, synced: rows.length, deactivated, pages, kb });
});

// Build a readable prose catalog from live Shopify products and upsert it as the
// single generated kb_documents row, then trigger kb-embed for just that doc.
async function syncKbDoc(
  sb: any,
  products: Array<{
    title: string;
    url: string | null;
    category: string | null;
    description: string;
    tags: string[];
    variants: Array<{ title: string; price: number | null; inStock: boolean }>;
  }>,
): Promise<{ ok: boolean; products: number; error?: string }> {
  if (!products.length) return { ok: true, products: 0 };

  const rupee = (n: number | null) => (n == null ? "" : `₹${Number.isInteger(n) ? n : n.toFixed(2)}`);
  const now = new Date().toISOString();

  const lines: string[] = [];
  lines.push("# PROMUNCH Live Product Catalog (promunch.in)");
  lines.push(
    "Current PROMUNCH listings, auto-synced from the live Shopify store. " +
      "Use it for what we sell online, what is in or out of stock, prices and the exact product link. " +
      "If a product is not listed here it is not sold on promunch.in right now. " +
      "Nutrition, ingredients and policies live in the Master KB, not here. " +
      `(Last synced: ${now}.)`,
  );
  lines.push("");

  for (const p of products) {
    const inStockVariants = p.variants.filter((v) => v.inStock);
    const availability = inStockVariants.length
      ? "in stock"
      : "currently out of stock / sold out";
    lines.push(`## ${p.title}${p.category ? ` (${p.category})` : ""}`);
    lines.push(`Availability: ${availability}.`);
    if (p.url) lines.push(`Link: ${p.url}`);
    if (p.description) lines.push(p.description);

    const named = p.variants.filter((v) => v.title);
    if (named.length) {
      lines.push("Variants / flavours:");
      for (const v of named) {
        const price = rupee(v.price);
        lines.push(
          `- ${v.title}${price ? `: ${price}` : ""} (${v.inStock ? "in stock" : "out of stock"})`,
        );
      }
    } else {
      const v = p.variants[0];
      if (v && v.price != null) lines.push(`Price: ${rupee(v.price)}.`);
    }
    if (p.tags.length) lines.push(`Tags: ${p.tags.join(", ")}.`);
    lines.push("");
  }

  const rawText = lines.join("\n").trim();

  // Upsert by stable name — one generated row, no duplicates across runs.
  const { data: existing } = await sb
    .from("kb_documents").select("id").eq("name", KB_DOC_NAME).limit(1).maybeSingle();

  let docId: string | null = existing?.id ?? null;
  if (docId) {
    const { error } = await sb
      .from("kb_documents")
      .update({ raw_text: rawText, status: "ready", source_type: "manual", processed_at: now, error: null })
      .eq("id", docId);
    if (error) return { ok: false, products: products.length, error: error.message };
  } else {
    const { data, error } = await sb
      .from("kb_documents")
      .insert({
        name: KB_DOC_NAME,
        source_type: "manual",
        raw_text: rawText,
        status: "ready",
        uploaded_by: "shopify-catalog-sync",
        processed_at: now,
      })
      .select("id").single();
    if (error) return { ok: false, products: products.length, error: error.message };
    docId = data?.id ?? null;
  }

  // Re-embed just this doc so semantic retrieval picks up the changes. Best-effort.
  if (docId) {
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/kb-embed`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ document_id: docId }),
      });
    } catch (e) {
      console.error("[shopify-catalog-sync] kb-embed trigger failed", e);
    }
  }

  return { ok: true, products: products.length };
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
