// Sync the Shopify product catalog → wa_catalog_items (the WhatsApp ordering
// mirror). Triggered manually from the dashboard (/api/shopify/catalog) or by
// cron. Reads ACTIVE products via the Admin GraphQL API and upserts one row per
// variant.
//
// CONVENTION (see docs/WHATSAPP_ORDERING.md): retailer_id = the Shopify variant
// numeric id, which must equal the Meta catalog Content ID. Build your Meta
// catalog with Content ID = variant id (CSV/feed) and this mirror lines up so a
// WhatsApp cart becomes a Shopify checkout link with no product lookups.
//
// The sync OWNS the table: variants it sees → in_stock per Shopify availability;
// any retailer_id it no longer sees → in_stock = false (retired / deleted).

import { db } from "../_shared/supabase.ts";
import { adminGraphQL } from "../_shared/shopify-customer.ts";

const PRODUCTS_QUERY = `
query CatalogSync($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        title
        productType
        variants(first: 100) {
          edges {
            node {
              id
              title
              price
              inventoryQuantity
              availableForSale
            }
          }
        }
      }
    }
  }
}`;

const MAX_PAGES = 20; // safety cap (1000 products) — plenty for this catalog

function variantNumericId(gid: string): string {
  // gid://shopify/ProductVariant/123456 -> "123456"
  const m = String(gid ?? "").match(/(\d+)\s*$/);
  return m ? m[1] : "";
}

Deno.serve(async (req) => {
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
          const inStock = v.availableForSale === true ||
            (v.availableForSale == null && (v.inventoryQuantity == null || v.inventoryQuantity > 0));
          rows.push({
            retailer_id: retailerId,
            title: String(title).slice(0, 200),
            category,
            price_inr: Number.isFinite(price as number) ? (price as number) : null,
            in_stock: inStock,
            sort: sort++,
            updated_at: new Date().toISOString(),
          });
        }
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

  return j({ ok: true, synced: rows.length, deactivated, pages });
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
