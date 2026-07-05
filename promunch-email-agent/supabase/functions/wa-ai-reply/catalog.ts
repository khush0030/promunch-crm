// product_list sections from the wa_catalog_items mirror.
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

import type { CatalogSection } from "../_shared/whatsapp.ts";
import { MAX_CATALOG_ITEMS, MAX_CATALOG_SECTIONS } from "./config.ts";

// Build product_list sections from the wa_catalog_items mirror. Groups in-stock
// items by category (Meta caps: 30 items / 10 sections), optionally filtered by
// a category/title keyword. Returns null when nothing matches.
export async function buildCatalogSections(
  sb: any,
  category: string | null,
): Promise<{ sections: CatalogSection[]; count: number; titles: string } | null> {
  let q = sb.from("wa_catalog_items").select("retailer_id, title, category, sort").eq("in_stock", true);
  // strip PostgREST control chars so a free-text category can't break the or() filter
  const c = (category ?? "").replace(/[(),.*%]/g, " ").trim().slice(0, 40);
  if (c) q = q.or(`category.ilike.%${c}%,title.ilike.%${c}%`);
  const { data, error } = await q
    .order("category", { ascending: true })
    .order("sort", { ascending: true })
    .limit(MAX_CATALOG_ITEMS);
  if (error || !data || !data.length) return null;

  const groups = new Map<string, Array<{ product_retailer_id: string }>>();
  for (const row of data) {
    const key = ((row.category ?? "More").toString().trim() || "More").slice(0, 24);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ product_retailer_id: String(row.retailer_id) });
  }
  let sections: CatalogSection[] = [...groups.entries()].map(([title, product_items]) => ({ title, product_items }));
  // Collapse any sections beyond Meta's cap into a final "More" section.
  if (sections.length > MAX_CATALOG_SECTIONS) {
    const head = sections.slice(0, MAX_CATALOG_SECTIONS - 1);
    const tail = sections.slice(MAX_CATALOG_SECTIONS - 1).flatMap((s) => s.product_items);
    head.push({ title: "More", product_items: tail });
    sections = head;
  }
  const count = sections.reduce((n, s) => n + s.product_items.length, 0);
  const titles = data.map((r: any) => r.title).slice(0, 12).join(", ");
  return { sections, count, titles };
}
