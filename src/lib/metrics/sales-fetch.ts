// Server-only row fetchers shared by /api/metrics/sales and
// /api/metrics/channels, so both read exactly the same rows with the same
// columns and the channel totals on the Sales and Channels tabs always match.

import { supabaseAdmin } from "@/lib/supabase-admin";
import type { AmazonFinanceRow, AmazonOrderRow, ShopifySalesRow } from "./sales-aggregate";

const PAGE_SIZE = 1000;

// PostgREST caps a single select at 1000 rows, so every table is walked in
// 1000-row pages ordered by its timestamp column; stop on a short page.
export async function fetchAll<T>(table: string, columns: string, tsColumn: string, sinceIso: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .gte(tsColumn, sinceIso)
      .order(tsColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export const fetchShopify = (sinceIso: string) =>
  fetchAll<ShopifySalesRow>(
    "shopify_orders",
    "total_price, shopify_created_at, financial_status, source_name, first_utm_source, first_source, is_creator, customer_order_index, line_items",
    "shopify_created_at",
    sinceIso,
  );

export const fetchAmazonFinance = (sinceIso: string) =>
  fetchAll<AmazonFinanceRow>("amazon_finance_events", "posted_date, gross, net, event_type", "posted_date", sinceIso);

export const fetchAmazonOrders = (sinceIso: string) =>
  fetchAll<AmazonOrderRow>("amazon_orders", "purchase_date, order_status", "purchase_date", sinceIso);
