// Server-side helpers for Email Studio: settings/brand kit, the product
// catalog (wa_catalog_items, the Shopify mirror kept fresh by
// shopify-catalog-sync), and the compliant per-recipient render.

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { normalizeBrand, type BrandKit, type EmailDesign, type ProductInfo } from "@/lib/email-studio/design";
import { renderDesign } from "@/lib/email-studio/render";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";

export type StudioSettings = {
  brand: BrandKit;
  approval_threshold: number;
  warmup_max_recipients: number | null;
};

export async function getStudioSettings(): Promise<StudioSettings> {
  const { data } = await supabase
    .from("email_studio_settings")
    .select("brand, approval_threshold, warmup_max_recipients")
    .eq("id", 1)
    .maybeSingle();
  const brand = normalizeBrand(data?.brand);
  if (!brand.footerAddress) brand.footerAddress = process.env.EMAIL_FOOTER_ADDRESS || "";
  return {
    brand,
    approval_threshold: typeof data?.approval_threshold === "number" ? data.approval_threshold : 2000,
    // Missing row (migration not applied yet) = treat as warm-up, the safe side.
    warmup_max_recipients: data ? (data.warmup_max_recipients ?? null) : 150,
  };
}

type CatalogRow = {
  retailer_id: string;
  title: string | null;
  product_title: string | null;
  variant_title: string | null;
  price_inr: number | string | null;
  compare_at_inr: number | string | null;
  image_url: string | null;
  product_url: string | null;
  in_stock: boolean | null;
  sort: number | null;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
}

export function toProduct(r: CatalogRow): ProductInfo {
  return {
    id: String(r.retailer_id),
    title: r.title || r.product_title || "PROMUNCH",
    price: num(r.price_inr),
    compareAt: num(r.compare_at_inr),
    image: r.image_url,
    url: r.product_url || "https://promunch.in",
    inStock: r.in_stock !== false,
  };
}

export async function listProducts(): Promise<ProductInfo[]> {
  const { data, error } = await supabase
    .from("wa_catalog_items")
    .select("retailer_id, title, product_title, variant_title, price_inr, compare_at_inr, image_url, product_url, in_stock, sort")
    .order("sort", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CatalogRow[]).map(toProduct);
}

export async function productMap(ids: string[]): Promise<Record<string, ProductInfo>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("wa_catalog_items")
    .select("retailer_id, title, product_title, variant_title, price_inr, compare_at_inr, image_url, product_url, in_stock, sort")
    .in("retailer_id", ids);
  if (error) throw new Error(error.message);
  const out: Record<string, ProductInfo> = {};
  for (const r of (data ?? []) as CatalogRow[]) out[String(r.retailer_id)] = toProduct(r);
  return out;
}

/** Slug used as utm_campaign so Shopify orders can be tied back. */
export function utmSlug(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "email"}-${id.slice(0, 6)}`;
}

export function renderForContact(
  design: EmailDesign,
  opts: {
    brand: BrandKit;
    products: Record<string, ProductInfo>;
    contact: { id: string; email: string | null; first_name: string | null; last_name: string | null };
    previewText?: string;
    utmCampaign?: string;
  },
): string {
  return renderDesign(design, {
    brand: opts.brand,
    products: opts.products,
    unsubscribeUrl: unsubscribeUrl(opts.contact.id),
    previewText: opts.previewText,
    utm: opts.utmCampaign ? { campaign: opts.utmCampaign } : undefined,
    merge: {
      first_name: opts.contact.first_name,
      last_name: opts.contact.last_name,
      email: opts.contact.email,
    },
  });
}
