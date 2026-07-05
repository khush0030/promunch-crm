// One-time backfill: explode amazon_finance_events.raw (ShipmentItemList /
// RefundItemList) into amazon_finance_item_events — the per-SKU fee ledger.
// Safe to re-run: upserts on dedup_key with ignoreDuplicates.
//
//   node scripts/amazon-backfill-item-events.mjs
//
// Mirrors itemEconomics() in promunch-email-agent/supabase/functions/_shared/amazon.ts.
// If that changes, change this too.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function itemEconomics(ev) {
  const items = ev.ShipmentItemList ?? ev.ShipmentItemAdjustmentList ?? ev.RefundItemList ?? [];
  const perEntry = items.map((it) => {
    let principal = 0, tax = 0, otherCharges = 0;
    for (const c of it.ItemChargeList ?? it.ItemChargeAdjustmentList ?? []) {
      const amt = num(c.ChargeAmount?.CurrencyAmount);
      const t = String(c.ChargeType ?? "");
      if (t === "Principal") principal += amt;
      else if (t.includes("Tax") && !t.startsWith("TCS") && !t.startsWith("TDS")) tax += amt;
      else otherCharges += amt;
    }
    let promo = 0;
    for (const p of it.PromotionList ?? it.PromotionAdjustmentList ?? []) promo += num(p.PromotionAmount?.CurrencyAmount);
    let referralFee = 0, fbaFee = 0, closingFee = 0, otherFees = 0;
    for (const f of it.ItemFeeList ?? it.ItemFeeAdjustmentList ?? []) {
      const amt = num(f.FeeAmount?.CurrencyAmount);
      const t = String(f.FeeType ?? "");
      if (t === "Commission" || t === "RefundCommission") referralFee += amt;
      else if (t.startsWith("FBA")) fbaFee += amt;
      else if (t.includes("ClosingFee")) closingFee += amt;
      else otherFees += amt;
    }
    // ItemTaxWithheldList ignored: TCS/TDS duplicated inside ItemChargeList.
    const gross = principal + tax + otherCharges;
    const net = gross + promo + referralFee + fbaFee + closingFee + otherFees;
    return {
      orderItemId: it.OrderItemId ?? it.OrderAdjustmentItemId ?? null,
      sellerSku: it.SellerSKU ?? null,
      quantity: num(it.QuantityShipped),
      principal, tax, otherCharges, gross, promo, referralFee, fbaFee, closingFee, otherFees, net,
    };
  });
  // Merge split entries sharing an OrderItemId (Amazon ships qty 2 as 1+1).
  const merged = new Map();
  perEntry.forEach((e, idx) => {
    const key = e.orderItemId ?? `idx-${idx}`;
    const prev = merged.get(key);
    if (!prev) { merged.set(key, { ...e }); return; }
    for (const k of ["quantity","principal","tax","otherCharges","gross","promo","referralFee","fbaFee","closingFee","otherFees","net"]) prev[k] += e[k];
  });
  return [...merged.values()];
}

const PAGE = 500;
let from = 0, events = 0, items = 0;
for (;;) {
  const { data, error } = await db.from("amazon_finance_events")
    .select("amazon_order_id, event_type, posted_date, raw")
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data?.length) break;

  const rows = [];
  for (const ev of data) {
    itemEconomics(ev.raw ?? {}).forEach((it, idx) => {
      rows.push({
        amazon_order_id: ev.amazon_order_id,
        order_item_id: it.orderItemId,
        event_type: ev.event_type,
        posted_date: ev.posted_date,
        seller_sku: it.sellerSku,
        quantity: it.quantity,
        principal: it.principal,
        tax: it.tax,
        other_charges: it.otherCharges,
        gross: it.gross,
        promo: it.promo,
        referral_fee: it.referralFee,
        fba_fee: it.fbaFee,
        closing_fee: it.closingFee,
        other_fees: it.otherFees,
        net: it.net,
        currency: "INR",
        dedup_key: `${ev.event_type}:${ev.amazon_order_id ?? "na"}:${ev.posted_date ?? "na"}:${it.orderItemId ?? idx}`,
      });
    });
  }
  if (rows.length) {
    const { error: upErr } = await db.from("amazon_finance_item_events")
      .upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
    if (upErr) throw new Error(upErr.message);
  }
  events += data.length;
  items += rows.length;
  console.log(`processed ${events} events → ${items} item rows`);
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log(`DONE: ${events} events exploded into ${items} per-SKU item rows`);

// Repair pass: the original order-level ledger stored every Refund event as ₹0
// (it didn't read the *AdjustmentList arrays). Recompute those rows from raw.
const { data: refunds, error: rErr } = await db.from("amazon_finance_events")
  .select("id, raw").eq("event_type", "Refund");
if (rErr) throw new Error(rErr.message);
let repaired = 0;
for (const r of refunds ?? []) {
  const its = itemEconomics(r.raw ?? {});
  if (!its.length) continue;
  const sum = (k) => its.reduce((a, i) => a + i[k], 0);
  const gross = sum("gross"), promo = sum("promo");
  const referral = sum("referralFee"), fba = sum("fbaFee");
  const other = sum("closingFee") + sum("otherFees");
  const { error: uErr } = await db.from("amazon_finance_events").update({
    gross, promo, referral_fee: referral, fba_fee: fba, other_fees: other,
    net: gross + promo + referral + fba + other,
  }).eq("id", r.id);
  if (uErr) throw new Error(uErr.message);
  repaired++;
}
console.log(`repaired ${repaired} order-level refund rows`);
