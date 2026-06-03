// Cron: reconciliation sweep for WhatsApp order confirmations.
//
// The instant path (shopify-wa, orders/create) sends "your order is
// confirmed!" — a transient failure, a missed webhook, or shopify-wa being
// down means that customer never gets it. This sweep is the safety net:
// shopify_orders is filled by a SEPARATE function (shopify-webhook) on every
// order, so it is the source of truth for "what orders actually happened".
// We diff that against confirmations actually delivered, and send what's
// missing.
//
// Two modes:
//   - cron (no body)    → scan orders 15min–24h old, send any missing.
//                         Schedule: */15 * * * *
//   - force (POST body) → {"orders":["1979","1980"]} — send exactly those,
//                         ignoring the time window, grace period and retry
//                         cap. For "make sure order X got its confirmation".
//
// NO-SPAM GUARANTEE: every mode — cron AND force — first checks wa_messages
// for an already-delivered confirmation for that order, and skips it if so.
// wa-send writes wa_messages transactionally on every send, so a customer is
// never messaged twice for the same order, no matter how this is triggered.

import { db } from "../_shared/supabase.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { firstName, toWaId } from "../_shared/journeys.ts";
import {
  buildConfirmationTemplate,
  claimConfirmation,
  confirmedOrderRefs,
  markConfirmationSent,
  releaseConfirmation,
} from "../_shared/confirmations.ts";

// Orders younger than this are left to the instant path. With the
// wa_messages dedup in place a real race is harmless, so this window only
// needs to be long enough to avoid spurious sends while the instant path is
// in flight — a couple of minutes is plenty.
const GRACE_MINUTES = 2;
// Don't resurrect very old orders in cron mode — a confirmation days late is noise.
const RESEND_WINDOW_HOURS = 24;
// Stop retrying an order once this many resend attempts have failed (a
// genuinely undeliverable number must not loop forever). Cron mode only.
const MAX_ATTEMPTS = 5;
const BATCH = 200;

// connector_events keyed by order number (retry-cap bookkeeping only —
// the no-spam dedup uses wa_messages, see confirmations.ts).
const EVT_SENT = "confirmation_sent";
const EVT_FAILED = "confirmation_resend_failed";
const EVT_GAVEUP = "confirmation_gave_up";

const norm = (s: string | null | undefined) => String(s ?? "").trim().replace(/^#/, "");

Deno.serve(async (req) => {
  const sb = db();

  // force mode — POST {"orders":[...]}; cron invokes with no/empty body
  let forced: string[] = [];
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (Array.isArray(body?.orders)) forced = body.orders.map((o: unknown) => norm(String(o))).filter(Boolean);
    } catch { /* no body — cron mode */ }
  }
  const force = forced.length > 0;
  const now = Date.now();

  // 1. candidate orders
  let query = sb
    .from("shopify_orders")
    .select("order_number, customer_phone, customer_name, total_price, financial_status, raw, shopify_created_at");
  if (force) {
    const variants = forced.flatMap((n) => [n, `#${n}`]);
    query = query.in("order_number", variants).limit(forced.length * 4);
  } else {
    const youngest = new Date(now - GRACE_MINUTES * 60_000).toISOString();
    const oldest = new Date(now - RESEND_WINDOW_HOURS * 3600_000).toISOString();
    query = query
      .gte("shopify_created_at", oldest)
      .lte("shopify_created_at", youngest)
      .order("shopify_created_at", { ascending: false })
      .limit(BATCH);
  }
  const { data: orders, error } = await query;
  if (error) return j({ ok: false, error: error.message }, 500);

  // 2. NO-SPAM dedup ledger — orders with an already-delivered confirmation.
  //    Built from wa_messages (transactional). Applied in BOTH modes: force
  //    bypasses the time window, never the "already sent" check.
  const dedupSince = new Date(now - 30 * 86400_000).toISOString();
  const confirmed = await confirmedOrderRefs(dedupSince);

  // 3. retry-cap bookkeeping (cron mode only) from connector_events
  const gaveUp = new Set<string>();
  const failCount = new Map<string, number>();
  if (!force) {
    const oldest = new Date(now - RESEND_WINDOW_HOURS * 3600_000).toISOString();
    const { data: events } = await sb
      .from("connector_events")
      .select("event, ref")
      .eq("connector", "shopify_wa")
      .in("event", [EVT_FAILED, EVT_GAVEUP])
      .gte("created_at", oldest);
    for (const e of events ?? []) {
      const ref = norm(e.ref);
      if (!ref) continue;
      if (e.event === EVT_GAVEUP) gaveUp.add(ref);
      else if (e.event === EVT_FAILED) failCount.set(ref, (failCount.get(ref) ?? 0) + 1);
    }
  }

  let resent = 0, failed = 0, skipped = 0;
  const report: Record<string, string> = {};

  for (const o of orders ?? []) {
    const orderRef = String(o.order_number ?? "");
    const ref = norm(orderRef);
    if (!ref) { skipped++; continue; }

    // already confirmed — hard skip, every mode. This is the no-spam guard.
    if (confirmed.has(ref)) { skipped++; report[orderRef] = "already-confirmed — skipped"; continue; }

    if (!force && gaveUp.has(ref)) { skipped++; report[orderRef] = "gave-up"; continue; }

    const raw = (o.raw ?? {}) as Record<string, any>;

    // never confirm a cancelled / reversed order — even in force mode
    const fin = String(o.financial_status ?? raw.financial_status ?? "").toLowerCase();
    if (raw.cancelled_at || fin === "voided" || fin === "refunded") {
      skipped++; report[orderRef] = "cancelled/refunded — not sent"; continue;
    }

    const waId = o.customer_phone
      ?? toWaId(raw.customer?.phone ?? raw.phone ?? raw.shipping_address?.phone ?? raw.billing_address?.phone);
    if (!waId) {
      await logConnector({
        connector: "shopify_wa", level: force ? "warn" : "info", event: "no_phone",
        message: `Order ${orderRef}: no usable phone — confirmation not sent.`,
        ref: orderRef, throttleMinutes: force ? 0 : RESEND_WINDOW_HOURS * 60,
      }).catch(() => {});
      skipped++; report[orderRef] = "no-phone-on-order";
      continue;
    }

    // retry cap (cron mode only)
    if (!force && (failCount.get(ref) ?? 0) >= MAX_ATTEMPTS) {
      await logConnector({
        connector: "shopify_wa", level: "error", event: EVT_GAVEUP,
        message: `Order ${orderRef}: confirmation still undelivered after ${MAX_ATTEMPTS} attempts — giving up. Resend it manually from the dashboard.`,
        ref: orderRef,
      }).catch(() => {});
      gaveUp.add(ref);
      skipped++; report[orderRef] = "gave-up";
      continue;
    }

    // Atomic claim — the same per-order DB lock the instant path uses. If
    // another path is sending this order right now, we stand down. This is
    // what makes "instant path + sweep both fire" safe instead of a duplicate.
    if (!(await claimConfirmation(orderRef))) {
      skipped++; report[orderRef] = "claimed by another path — skipped";
      continue;
    }

    // build the same message the instant path would have sent
    const name = firstName(raw.customer?.first_name, raw.shipping_address?.first_name, raw.billing_address?.first_name, o.customer_name);

    const res = await callWaSend({
      to: waId,
      kind: "template",
      template: buildConfirmationTemplate(name, orderRef),
      sent_by: force ? "sweep:force" : "sweep:order_confirmation",
    });

    if (res?.ok) {
      await markConfirmationSent(orderRef); // lock the claim — never re-send
      confirmed.add(ref); // in-batch guard against the same ref twice
      resent++; report[orderRef] = `sent to ${waId}`;
      await logConnector({
        connector: "shopify_wa", level: "info", event: EVT_SENT,
        message: force
          ? `Order ${orderRef}: WhatsApp confirmation sent to ${waId} (manual force).`
          : `Order ${orderRef}: WhatsApp confirmation re-sent to ${waId} by reconciliation sweep (instant path had missed it).`,
        ref: orderRef,
      }).catch(() => {});
    } else {
      await releaseConfirmation(orderRef); // failed — let a later run retry
      failed++; report[orderRef] = `failed — ${res?.error ?? "unknown"}`;
      await logConnector({
        connector: "shopify_wa", level: "error", event: EVT_FAILED,
        message: `Order ${orderRef}: confirmation ${force ? "force-" : "re"}send failed — ${res?.error ?? "unknown"}.`,
        ref: orderRef,
      }).catch(() => {});
    }
  }

  // in force mode, flag any requested order that wasn't found at all
  if (force) {
    const found = new Set((orders ?? []).map((o) => norm(o.order_number)));
    for (const n of forced) if (!found.has(n)) report[`#${n}`] = "order not found in shopify_orders";
  }

  // Proactive Slack alert: anything still missing after this sweep, eligible
  // to confirm, and older than 5 min. Pings the team via Slack (10-min
  // throttled inside logConnector) so a real miss is noticed before any
  // customer complains. Cron mode only.
  let stuckCount = 0;
  if (!force) {
    const stuckYoungest = new Date(now - 5 * 60_000).toISOString();
    const stuckOldest = new Date(now - 60 * 60_000).toISOString();
    const { data: stuckCandidates } = await sb
      .from("shopify_orders")
      .select("order_number, financial_status, raw")
      .gte("shopify_created_at", stuckOldest)
      .lte("shopify_created_at", stuckYoungest)
      .not("customer_phone", "is", null)
      .limit(100);
    const stuck = (stuckCandidates ?? [])
      .filter((o) => {
        const r = (o.raw ?? {}) as Record<string, unknown>;
        const fin = String(o.financial_status ?? r.financial_status ?? "").toLowerCase();
        if (fin === "voided" || fin === "refunded" || r.cancelled_at) return false;
        return !confirmed.has(norm(o.order_number));
      })
      .map((o) => String(o.order_number));
    stuckCount = stuck.length;
    if (stuckCount > 0) {
      await logConnector({
        connector: "shopify_wa", level: "error", event: "confirmation_stuck",
        message: `${stuckCount} order(s) older than 5 min still without a WhatsApp confirmation: ${stuck.slice(0, 10).join(", ")}${stuckCount > 10 ? ` …+${stuckCount - 10} more` : ""}. Sweep will keep retrying; open /dashboard/order-confirmations.`,
        detail: { orders: stuck },
      }).catch(() => {});
    }
  }

  return j({ ok: true, mode: force ? "force" : "cron", scanned: orders?.length ?? 0, resent, failed, skipped, stuck: stuckCount, report });
});

// Send via the wa-send edge function (records the message + thread).
async function callWaSend(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wa-send`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
