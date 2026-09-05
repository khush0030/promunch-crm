import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// PUBLIC: the Meta Commerce catalogue pulls this on a schedule (Catalogue →
// Data sources → Scheduled feed). One row per Shopify variant, built from
// wa_catalog_items, which shopify-catalog-sync refreshes every 30 minutes.
//
// THE INVARIANT THAT MAKES IN-CHAT ORDERING WORK: `id` is the Shopify variant
// numeric id. Meta echoes it back as product_retailer_id on the `order`
// webhook, so wa-webhook can turn a WhatsApp cart into a Shopify cart link with
// no product lookup. Never change what goes in this column.
//
// Format is Meta's CSV spec (same field names as Facebook's product feed):
//   https://www.facebook.com/business/help/120325381656392
//
// `link` points at the product page rather than a cart permalink on purpose:
// that page loads the Juspay Breeze SDK, so a customer who taps through from a
// product card checks out through Breeze like any other storefront visitor.

interface Row {
  retailer_id: string;
  title: string | null;
  product_title: string | null;
  variant_title: string | null;
  description: string | null;
  category: string | null;
  price_inr: number | null;
  compare_at_inr: number | null;
  in_stock: boolean;
  inventory_quantity: number | null;
  product_url: string | null;
  image_url: string | null;
  sku: string | null;
  tags: string[] | null;
}

const HEADERS = [
  "id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "sale_price",
  "link",
  "image_link",
  "brand",
  "google_product_category",
  "product_type",
  "quantity_to_sell_on_facebook",
  "inventory",
  "mpn",
] as const;

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("wa_catalog_items")
    .select(
      "retailer_id,title,product_title,variant_title,description,category,price_inr," +
        "compare_at_inr,in_stock,inventory_quantity,product_url,image_url,sku,tags",
    )
    .order("sort", { ascending: true });

  if (error) {
    return new NextResponse(`error: ${error.message}`, { status: 500 });
  }

  // Cast through unknown: the generated Supabase types predate the columns
  // migration 20260905120000/20260905160000 added, so the client infers an
  // error-shaped row for this select.
  const rows = (data ?? []) as unknown as Row[];
  const lines: string[] = [HEADERS.join(",")];
  let skipped = 0;

  for (const r of rows) {
    // Meta rejects a row with no image or no price, and a rejected row is worse
    // than an absent one: it shows up as a permanent feed error.
    if (!r.image_url || r.price_inr == null || !r.product_url) {
      skipped++;
      continue;
    }
    const name = clean(r.title || r.product_title || "PROMUNCH snack");
    const qty = r.in_stock ? Math.max(1, r.inventory_quantity ?? 1) : 0;
    const sale = r.compare_at_inr != null && r.compare_at_inr > r.price_inr
      ? money(r.price_inr)
      : "";
    const listPrice = r.compare_at_inr != null && r.compare_at_inr > r.price_inr
      ? r.compare_at_inr
      : r.price_inr;

    lines.push(
      [
        r.retailer_id,
        name,
        clean(r.description || name),
        r.in_stock ? "in stock" : "out of stock",
        "new",
        money(listPrice),
        sale,
        r.product_url,
        r.image_url,
        "PROMUNCH",
        // Meta's taxonomy id for Food, Beverages & Tobacco > Food Items > Snack Foods
        "428",
        clean(r.category || "Snacks"),
        String(qty),
        String(qty),
        r.sku || r.retailer_id,
      ]
        .map(csv)
        .join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'inline; filename="promunch-meta-catalog.csv"',
      // Meta re-pulls on its own schedule; a short cache keeps a manual
      // "Fetch now" from hammering the database while staying fresh.
      "cache-control": "public, max-age=300",
      "x-rows": String(lines.length - 1),
      "x-skipped": String(skipped),
    },
  });
}

// Meta wants "600.00 INR".
function money(n: number): string {
  return `${n.toFixed(2)} INR`;
}

// Strip the characters that break a feed row or a customer-facing card:
// newlines, and the dashes PROMUNCH copy rules ban.
function clean(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, "-")
    .trim()
    .slice(0, 5000);
}

function csv(v: string): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
