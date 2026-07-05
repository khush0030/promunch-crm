// Amazon Selling Partner API (SP-API) client.
//
// Region: India lives in Amazon's EUROPE region group.
//   endpoint   = https://sellingpartnerapi-eu.amazon.com   (AMAZON_SP_ENDPOINT)
//   marketplace = A21TJRUUN4KGV (amazon.in)                (AMAZON_MARKETPLACE_ID)
//
// Auth (current SP-API — the old AWS SigV4/IAM requirement was REMOVED):
//   1. refresh_token (long-lived) -> LWA access_token (~1h) via api.amazon.com
//   2. call SP-API with header `x-amz-access-token: <access_token>`
//   3. for RESTRICTED data (buyer PII, shipping address, messaging) first mint a
//      Restricted Data Token (RDT) via the Tokens API, then use THAT token for
//      that one call. We avoid PII by default, so most calls use the plain token.
//
// Secrets required (set in Supabase → Edge Functions → Secrets):
//   AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_SP_REFRESH_TOKEN
//   AMAZON_MARKETPLACE_ID, AMAZON_SP_ENDPOINT

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const SP_ENDPOINT = () => Deno.env.get("AMAZON_SP_ENDPOINT") ?? "https://sellingpartnerapi-eu.amazon.com";
export const MARKETPLACE_ID = () => Deno.env.get("AMAZON_MARKETPLACE_ID") ?? "A21TJRUUN4KGV";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- LWA access-token cache -------------------------------------------------
// Cached across warm invocations; refreshed ~1 min before expiry.
let _token: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.value;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env("AMAZON_SP_REFRESH_TOKEN"),
    client_id: env("AMAZON_LWA_CLIENT_ID"),
    client_secret: env("AMAZON_LWA_CLIENT_SECRET"),
  });
  const r = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error(`LWA token failed: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  }
  _token = { value: j.access_token, expiresAt: Date.now() + (Number(j.expires_in ?? 3600) * 1000) };
  return _token.value;
}

// ---- Restricted Data Token (only for PII / messaging operations) ------------
export async function getRDT(restrictedResources: Array<{
  method: string;
  path: string;
  dataElements?: string[];
}>): Promise<string> {
  const token = await getAccessToken();
  const r = await fetch(`${SP_ENDPOINT()}/tokens/2021-03-01/restrictedDataToken`, {
    method: "POST",
    headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ restrictedResources }),
  });
  const j = await r.json();
  if (!r.ok || !j.restrictedDataToken) {
    throw new Error(`RDT failed: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  }
  return j.restrictedDataToken as string;
}

// ---- Core signed GET with 429/5xx backoff -----------------------------------
// SP-API rate limits are per-operation and tight (getOrders ~1 req/min). The
// caller controls cadence; this just retries transient throttles politely.
export async function spGet(
  path: string,
  query: Record<string, string | undefined> = {},
  opts: { token?: string; attempt?: number } = {},
): Promise<any> {
  const token = opts.token ?? await getAccessToken();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.set(k, v);
  const url = `${SP_ENDPOINT()}${path}${qs.toString() ? `?${qs}` : ""}`;

  const r = await fetch(url, { headers: { "x-amz-access-token": token } });
  if (r.status === 429 || r.status >= 500) {
    const attempt = opts.attempt ?? 0;
    if (attempt < 4) {
      await sleep(2000 * Math.pow(2, attempt)); // 2s,4s,8s,16s
      return spGet(path, query, { ...opts, attempt: attempt + 1 });
    }
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.errors?.[0]?.message ?? JSON.stringify(j).slice(0, 300);
    throw new Error(`SP-API ${r.status} ${path}: ${msg}`);
  }
  return j;
}

// ---- Orders -----------------------------------------------------------------
// LastUpdatedAfter catches both new orders AND status changes (shipped, cancelled,
// refunded) since the watermark, so re-polling keeps existing rows fresh.
export interface AmazonOrder {
  AmazonOrderId: string;
  PurchaseDate?: string;
  LastUpdateDate?: string;
  OrderStatus?: string;
  OrderTotal?: { CurrencyCode?: string; Amount?: string };
  FulfillmentChannel?: string; // AFN = FBA, MFN = merchant-fulfilled
  SalesChannel?: string;
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  IsPrime?: boolean;
  ShipmentServiceLevelCategory?: string;
  [k: string]: unknown;
}

// Pages the full result set via NextToken. `since` is an ISO timestamp.
export async function getOrders(opts: { since: string; mode?: "created" | "updated" }): Promise<AmazonOrder[]> {
  const key = opts.mode === "created" ? "CreatedAfter" : "LastUpdatedAfter";
  const out: AmazonOrder[] = [];
  let nextToken: string | undefined;
  do {
    const j: any = await spGet("/orders/v0/orders", {
      MarketplaceIds: MARKETPLACE_ID(),
      [key]: nextToken ? undefined : opts.since,
      NextToken: nextToken,
    });
    const payload = j?.payload ?? {};
    out.push(...(payload.Orders ?? []));
    nextToken = payload.NextToken;
    if (nextToken) await sleep(700); // getOrders is heavily throttled
  } while (nextToken);
  return out;
}

export interface AmazonOrderItem {
  OrderItemId: string;
  SellerSKU?: string;
  ASIN?: string;
  Title?: string;
  QuantityOrdered?: number;
  ItemPrice?: { CurrencyCode?: string; Amount?: string };
  [k: string]: unknown;
}

export async function getOrderItems(orderId: string): Promise<AmazonOrderItem[]> {
  const out: AmazonOrderItem[] = [];
  let nextToken: string | undefined;
  do {
    const j: any = await spGet(`/orders/v0/orders/${orderId}/orderItems`, { NextToken: nextToken });
    const payload = j?.payload ?? {};
    out.push(...(payload.OrderItems ?? []));
    nextToken = payload.NextToken;
    if (nextToken) await sleep(400);
  } while (nextToken);
  return out;
}

// ---- FBA Inventory ----------------------------------------------------------
export interface InventorySummary {
  asin?: string;
  fnSku?: string;
  sellerSku?: string;
  productName?: string;
  totalQuantity?: number;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    reservedQuantity?: { totalReservedQuantity?: number };
    inboundWorkingQuantity?: number;
    inboundShippedQuantity?: number;
    inboundReceivingQuantity?: number;
  };
  [k: string]: unknown;
}

export async function getInventorySummaries(): Promise<InventorySummary[]> {
  const out: InventorySummary[] = [];
  let nextToken: string | undefined;
  do {
    const j: any = await spGet("/fba/inventory/v1/summaries", {
      granularityType: "Marketplace",
      granularityId: MARKETPLACE_ID(),
      marketplaceIds: MARKETPLACE_ID(),
      details: "true",
      nextToken,
    });
    out.push(...(j?.payload?.inventorySummaries ?? []));
    nextToken = j?.pagination?.nextToken;
    if (nextToken) await sleep(400);
  } while (nextToken);
  return out;
}

// ---- Finances ---------------------------------------------------------------
// Returns the financial-events groups, MERGED across all pages. Pagination is
// essential: reconciliation sums these into computed_net, so a missed page would
// show a phantom variance. Page count is capped to stay under the worker limit;
// steady-state windows are tiny, wide backfills should use a separate run.
export async function listFinancialEvents(opts: { since: string; maxPages?: number }): Promise<any> {
  const merged: Record<string, any[]> = {};
  let nextToken: string | undefined;
  let pages = 0;
  const cap = opts.maxPages ?? 15;
  do {
    const j: any = await spGet("/finances/v0/financialEvents", {
      PostedAfter: nextToken ? undefined : opts.since,
      NextToken: nextToken,
      MaxResultsPerPage: "100",
    });
    const ev = j?.payload?.FinancialEvents ?? {};
    for (const [k, v] of Object.entries(ev)) {
      if (Array.isArray(v)) merged[k] = (merged[k] ?? []).concat(v);
    }
    nextToken = j?.payload?.NextToken;
    pages++;
    if (nextToken && pages < cap) await sleep(600);
  } while (nextToken && pages < cap);
  return merged;
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---- Finance fee breakdown --------------------------------------------------
// Turns one ShipmentEvent/RefundEvent into the economics we care about:
//   gross  = what the buyer paid   (Principal + Tax + Shipping + GiftWrap …)
//   promo  = promotions/discounts  (negative)
//   referralFee, fbaFee, otherFees = Amazon's cuts (negative, as Amazon returns them)
//   net    = gross + promo + all fees  (= contribution to your payout)
export interface OrderEconomics {
  gross: number; promo: number; referralFee: number; fbaFee: number; otherFees: number; net: number;
}

export function shipmentEconomics(ev: any): OrderEconomics {
  let gross = 0, promo = 0, referralFee = 0, fbaFee = 0, otherFees = 0;
  // Refund events nest items under ShipmentItemAdjustmentList with *AdjustmentList
  // fee/charge arrays — miss those and every refund silently counts as ₹0.
  const items = ev.ShipmentItemList ?? ev.ShipmentItemAdjustmentList ?? ev.RefundItemList ?? [];
  for (const it of items) {
    for (const c of it.ItemChargeList ?? it.ItemChargeAdjustmentList ?? []) gross += num(c.ChargeAmount?.CurrencyAmount);
    for (const p of it.PromotionList ?? it.PromotionAdjustmentList ?? []) promo += num(p.PromotionAmount?.CurrencyAmount);
    for (const f of it.ItemFeeList ?? it.ItemFeeAdjustmentList ?? []) {
      const amt = num(f.FeeAmount?.CurrencyAmount);
      const t = String(f.FeeType ?? "");
      if (t === "Commission" || t === "RefundCommission") referralFee += amt;
      else if (t.startsWith("FBA")) fbaFee += amt;
      else otherFees += amt;
    }
  }
  // order-level fees (outside item lists)
  for (const f of ev.ShipmentFeeList ?? ev.ShipmentFeeAdjustmentList ?? ev.OrderFeeList ?? ev.OrderFeeAdjustmentList ?? []) otherFees += num(f.FeeAmount?.CurrencyAmount);
  for (const p of ev.PromotionList ?? ev.PromotionAdjustmentList ?? []) promo += num(p.PromotionAmount?.CurrencyAmount);
  const net = gross + promo + referralFee + fbaFee + otherFees;
  return { gross, promo, referralFee, fbaFee, otherFees, net };
}

// ---- Per-item (per-SKU) fee breakdown ----------------------------------------
// One ShipmentEvent/RefundEvent contains N items, each with its own SKU, qty and
// fee lists. This is the ONLY place Amazon exposes per-SKU economics, so we
// flatten each item into a row for amazon_finance_item_events.
export interface ItemEconomics {
  orderItemId: string | null;
  sellerSku: string | null;
  quantity: number;
  principal: number; tax: number; otherCharges: number; gross: number;
  promo: number; referralFee: number; fbaFee: number; closingFee: number; otherFees: number;
  net: number;
}

export function itemEconomics(ev: any): ItemEconomics[] {
  const items = ev.ShipmentItemList ?? ev.ShipmentItemAdjustmentList ?? ev.RefundItemList ?? [];
  const perEntry = items.map((it: any) => {
    let principal = 0, tax = 0, otherCharges = 0;
    // Refund events use ItemChargeAdjustmentList / ItemFeeAdjustmentList etc.
    for (const c of it.ItemChargeList ?? it.ItemChargeAdjustmentList ?? []) {
      const amt = num(c.ChargeAmount?.CurrencyAmount);
      const t = String(c.ChargeType ?? "");
      if (t === "Principal") principal += amt;
      else if (t.includes("Tax") && !t.startsWith("TCS") && !t.startsWith("TDS")) tax += amt;
      else otherCharges += amt;
    }
    let promo = 0;
    for (const p of it.PromotionList ?? it.PromotionAdjustmentList ?? []) {
      promo += num(p.PromotionAmount?.CurrencyAmount);
    }
    let referralFee = 0, fbaFee = 0, closingFee = 0, otherFees = 0;
    for (const f of it.ItemFeeList ?? it.ItemFeeAdjustmentList ?? []) {
      const amt = num(f.FeeAmount?.CurrencyAmount);
      const t = String(f.FeeType ?? "");
      if (t === "Commission" || t === "RefundCommission") referralFee += amt;
      else if (t.startsWith("FBA")) fbaFee += amt;
      else if (t.includes("ClosingFee")) closingFee += amt;
      else otherFees += amt;
    }
    // NOTE: ItemTaxWithheldList is deliberately ignored — TCS/TDS lines are
    // duplicated inside ItemChargeList (verified 67/67 events), and the
    // order-level ledger that reconciles against bank deposits counts them once.
    const gross = principal + tax + otherCharges;
    const net = gross + promo + referralFee + fbaFee + closingFee + otherFees;
    return {
      orderItemId: it.OrderItemId ?? it.OrderAdjustmentItemId ?? null,
      sellerSku: it.SellerSKU ?? null,
      quantity: num(it.QuantityShipped),
      principal, tax, otherCharges, gross,
      promo, referralFee, fbaFee, closingFee, otherFees, net,
    };
  });
  // Amazon can split ONE order item across multiple list entries (e.g. qty 2
  // shipped as 1+1, each with its own charges). Merge by OrderItemId so the
  // dedup key stays stable and no entry is silently dropped on upsert.
  const merged = new Map<string, ItemEconomics>();
  perEntry.forEach((e: ItemEconomics, idx: number) => {
    const key = e.orderItemId ?? `idx-${idx}`;
    const prev = merged.get(key);
    if (!prev) { merged.set(key, { ...e }); return; }
    prev.quantity += e.quantity;
    prev.principal += e.principal; prev.tax += e.tax; prev.otherCharges += e.otherCharges;
    prev.gross += e.gross; prev.promo += e.promo;
    prev.referralFee += e.referralFee; prev.fbaFee += e.fbaFee;
    prev.closingFee += e.closingFee; prev.otherFees += e.otherFees;
    prev.net += e.net;
  });
  return [...merged.values()];
}

// ---- Reports API (used for the V2 Settlement Report = bank-truth deposits) ---
// Settlement reports are AUTO-generated by Amazon each settlement period; you
// can't request them on demand — you list what's available and download.
export const SETTLEMENT_REPORT_TYPE = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2";

export async function getReports(reportType: string, opts: { pageSize?: number } = {}): Promise<any[]> {
  const j: any = await spGet("/reports/2021-06-30/reports", {
    reportTypes: reportType,
    marketplaceIds: MARKETPLACE_ID(),
    pageSize: String(opts.pageSize ?? 20),
  });
  return j?.reports ?? [];
}

export async function getReportDocumentMeta(reportDocumentId: string): Promise<{ url: string; compressionAlgorithm?: string }> {
  const j: any = await spGet(`/reports/2021-06-30/documents/${reportDocumentId}`);
  return { url: j.url, compressionAlgorithm: j.compressionAlgorithm };
}

// Downloads a report document and returns its decoded text (handles GZIP).
export async function fetchReportText(reportDocumentId: string): Promise<string> {
  const meta = await getReportDocumentMeta(reportDocumentId);
  const r = await fetch(meta.url); // presigned S3 URL — no auth header
  if (!r.ok) throw new Error(`report download ${r.status}`);
  if (meta.compressionAlgorithm === "GZIP") {
    const ds = new DecompressionStream("gzip");
    // Type-only cast: Deno's dom lib disagrees with itself on the Uint8Array
    // generic (ArrayBuffer vs ArrayBufferLike); runtime is unaffected.
    const stream = (r.body as ReadableStream<Uint8Array>).pipeThrough<Uint8Array>(
      ds as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
    );
    return await new Response(stream).text();
  }
  return await r.text();
}

// Parses Amazon's tab-separated flat-file reports into row objects.
export function parseTSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (cells[i] ?? "").trim(); });
    return row;
  });
}
