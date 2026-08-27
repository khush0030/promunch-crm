// Shopify -> WhatsApp webhook.
//
// A SEPARATE webhook from shopify-webhook (which posts orders to Slack) — this
// one drives the WhatsApp customer journeys. Subscribe these Shopify topics to
// this function's URL:
//   orders/create     -> send order confirmation + enrol review/replenishment
//   orders/fulfilled  -> send shipping update
//   checkouts/create  -> enrol abandoned-checkout reminder
//
// Order confirmations are treated as utility messages (sent to anyone who gave
// a phone at checkout). Marketing-category journeys carry an opt-out footer.

import { db } from "../_shared/supabase.ts";
import { verifyShopifyHmac } from "../_shared/shopify.ts";
import { logConnector } from "../_shared/connector-log.ts";
import { SITE_URL, firstName, toWaId } from "../_shared/journeys.ts";
import { getFlowSettings } from "../_shared/flow-settings.ts";
import { handleOrderCreated } from "../_shared/order-confirmation.ts";
import { claimSend, markSendSent, releaseSend } from "../_shared/confirmations.ts";
import { enrolCustomFlows } from "../_shared/custom-flows.ts";
import { enrolEmailFlow } from "../_shared/email-flows.ts";
import { VOICE_TEMPLATE } from "../_shared/voice-eligibility.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  if (!secret) return new Response("server-misconfig", { status: 500 });
  // checkouts/* is signed with the client-credentials app's secret (see
  // verifyShopifyHmac) — accept either, or every cart webhook 401s in silence.
  if (!(await verifyShopifyHmac(raw, hmac, secret, [Deno.env.get("SHOPIFY_CLIENT_SECRET")]))) {
    await logConnector({
      connector: "shopify_wa", level: "error", event: "webhook_bad_hmac",
      message: `Rejected ${req.headers.get("x-shopify-topic") ?? "unknown"} webhook: HMAC matched no configured secret.`,
    }).catch(() => {});
    return new Response("bad-hmac", { status: 401 });
  }

  const topic = req.headers.get("x-shopify-topic") ?? "";
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad-json", { status: 400 }); }

  try {
    if (topic === "orders/create") await handleOrderCreated(payload);
    else if (topic === "orders/fulfilled") await handleOrderFulfilled(payload);
    else if (topic === "orders/cancelled") await handleOrderCancelled(payload);
    else if (topic === "checkouts/create" || topic === "checkouts/update") await handleCheckout(payload);
    // other topics (orders/updated, …) are acknowledged, no-op
  } catch (e) {
    console.error("[shopify-wa]", topic, e);
    await logConnector({
      connector: "shopify_wa",
      level: "error",
      event: "handler_failed",
      message: `${topic} handler failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
    }).catch(() => {});
    // still 200 — Shopify retries non-2xx aggressively
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
});

// orders/create is delegated to the shared handleOrderCreated — see
// _shared/order-confirmation.ts. shopify-webhook (the proven-reliable
// Shopify entry point) also calls it, so the confirmation goes out no
// matter which Shopify subscription delivers first.

// --- orders/fulfilled: shipping update --------------------------------------
async function handleOrderFulfilled(order: any) {
  const orderRef: string = order.name || `#${order.order_number}` || String(order.id);
  // Don't send a shipping update for an order that was cancelled.
  if (!orderIsActive(order)) return;
  const waId = toWaId(
    order.customer?.phone ?? order.phone ?? order.shipping_address?.phone ?? order.billing_address?.phone,
  );
  if (!waId) return;

  const name = firstName(order.customer?.first_name, order.shipping_address?.first_name);

  // User-created flows on this trigger (own atomic claim per flow+order;
  // independent of the built-in shipping-update toggle).
  await enrolCustomFlows("order_fulfilled", { waId, name, entityRef: orderRef })
    .catch((e) => console.warn("[shopify-wa] custom enrol (fulfilled):", e));

  // Dashboard kill-switch (Flows tab).
  if (!(await getFlowSettings()).shipping_update_enabled) return;

  const f = Array.isArray(order.fulfillments) ? order.fulfillments[0] : null;
  const tracking: string = resolveTrackingUrl(f, order);

  // NO-SPAM: exactly one shipping update per fulfillment. Shopify re-delivers
  // orders/fulfilled on retries / order edits, and we always return 200, so
  // without this guard the customer gets "your order shipped!" several times.
  // Key on the fulfillment id (falls back to tracking number) so a genuine
  // SECOND shipment — a different fulfillment — still gets its own update.
  const fid = String(f?.id ?? f?.tracking_number ?? f?.tracking_numbers?.[0] ?? "x");
  const claimKey = `shipping_update:${orderRef}:${fid}`;
  if (!(await claimSend(claimKey))) {
    await logConnector({
      connector: "shopify_wa", level: "info", event: "shipping_skipped_dup",
      message: `Order ${orderRef}: shipping update for fulfillment ${fid} already sent — not re-sending.`,
      ref: orderRef,
    }).catch(() => {});
    return;
  }

  const res = await callWaSend({
    to: waId,
    kind: "template",
    template: { name: "shipping_update", language: "en", vars: { "1": name, "2": orderRef, "3": tracking } },
    sent_by: "journey:shipping_update",
  });
  // Lock the claim on success; release on failure so a webhook re-delivery can retry.
  if (res?.ok) await markSendSent(claimKey); else await releaseSend(claimKey);
  await logConnector({
    connector: "shopify_wa",
    level: res?.ok ? "info" : "error",
    event: res?.ok ? "shipping_sent" : "shipping_failed",
    message: res?.ok
      ? `Order ${orderRef}: WhatsApp shipping update sent.`
      : `Order ${orderRef}: shipping update failed — ${res?.error ?? "unknown"}.`,
    ref: orderRef,
  }).catch(() => {});
}

// --- orders/cancelled: stop pending post-purchase journeys ------------------
async function handleOrderCancelled(order: any) {
  const sb = db();
  const orderRef: string = order.name || `#${order.order_number}` || String(order.id);

  // Cancel any review-request / replenishment runs still queued for this
  // order so we never message "hope you're loving your snacks" about an
  // order that no longer exists.
  const { data: stopped } = await sb.from("wa_journey_runs")
    .update({ status: "cancelled", last_error: "order cancelled" })
    .eq("order_ref", orderRef).eq("status", "active")
    .select("id");

  await logConnector({
    connector: "shopify_wa", level: "info", event: "order_cancelled",
    message: `Order ${orderRef} cancelled — stopped ${stopped?.length ?? 0} pending journey message(s).`,
    ref: orderRef,
  }).catch(() => {});
}

// Pull the checkout partner's recovery URL out of the order note. The partner
// writes it into `note` (free text); we also scan `note_attributes` values as a
// safety net in case it ever moves there. Returns the first http(s) URL found,
// or null if the note has none.
function noteCheckoutUrl(checkout: any): string | null {
  // Trailing ) . , " ' are note punctuation, not part of the link.
  const URL_RE = /https?:\/\/[^\s"'<>]+[^\s"'<>.,;:)\]]/g;
  // Super Money Breeze stamps its recovery links with these markers. Prefer a
  // marked link over "first URL in the note": a note can also carry an unrelated
  // link (support page, invoice, tracking), and sending that instead of the
  // recovery URL silently costs the whole cart.
  const SMB_RE = /(atomsSt=|bzCartRec=)/;

  const candidates: string[] = [];
  const note = String(checkout?.note ?? "");
  candidates.push(...(note.match(URL_RE) ?? []));
  const attrs = Array.isArray(checkout?.note_attributes) ? checkout.note_attributes : [];
  for (const a of attrs) {
    candidates.push(...(String(a?.value ?? "").match(URL_RE) ?? []));
  }
  if (candidates.length === 0) return null;
  return candidates.find((u) => SMB_RE.test(u)) ?? candidates[0];
}

// Rebase a storefront link onto the brand domain. The Super Money Breeze
// recovery link arrives on the raw myshopify host; promunch.in is the store's
// primary domain and serves the same storefront paths, so the cart rehydrates
// identically. Scoped to the myshopify host on purpose — any other host (a
// partner-owned domain, say) is left exactly as the partner wrote it.
function brandUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/\.myshopify\.com$/i.test(u.hostname)) return url;
    const site = new URL(SITE_URL);
    u.protocol = site.protocol;
    u.host = site.host;
    return u.toString();
  } catch {
    return url;
  }
}

/** Path + query + hash of a URL (what the template's {{1}} suffix needs). */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}` || "/cart";
  } catch {
    return url.replace(/^https?:\/\/[^/]+/, "") || "/cart";
  }
}

/** Stamp a recovery link with UTMs so recovered orders are attributable. */
function withUtm(url: string, content: string): string {
  try {
    const u = new URL(url);
    // Never clobber params the checkout partner put there (atomsSt/bzCartRec
    // are what actually rehydrate the cart).
    u.searchParams.set("utm_source", "whatsapp");
    u.searchParams.set("utm_medium", "cart_recovery");
    u.searchParams.set("utm_campaign", "abandoned_cart");
    u.searchParams.set("utm_content", content);
    return u.toString();
  } catch {
    return url;
  }
}

// --- checkouts/create + checkouts/update: abandoned-checkout enrolment ------
// Routed for both topics. TWO independent guards keep this from spamming:
//   1. per CHECKOUT TOKEN  — a given cart enrols exactly once, the first time a
//      usable phone number appears on it (often only on a later
//      checkouts/update, not at creation).
//   2. per CUSTOMER (wa_id) — a person can only ever have ONE live recovery
//      sequence. A second cart refreshes the running one instead of stacking a
//      parallel sequence on top of it. See the long note further down.
async function handleCheckout(checkout: any) {
  const sb = db();
  const token: string = String(checkout.token ?? checkout.id ?? "");
  if (!token) return;

  // Email abandoned-cart flow. Enrols on the checkout's EMAIL, so it works even
  // when there is no phone (the WhatsApp path below requires a phone). DB-only:
  // the app-side email-flow-tick sends. No-op unless an Active checkout_abandoned
  // flow exists; idempotent per (flow, token). Reuses the Super Money Breeze
  // recovery link from noteCheckoutUrl.
  try {
    const email = checkout.email ?? checkout.customer?.email ?? null;
    const nm = firstName(checkout.customer?.first_name, checkout.shipping_address?.first_name);
    const rUrl = brandUrl(
      noteCheckoutUrl(checkout) || checkout.abandoned_checkout_url || `${SITE_URL}/cart`,
    );
    // Carry the actual cart so the recovery emails can name what they left
    // behind ("your 2 Cream & Onion Crunchies") instead of "your cart". Kept to
    // the fields the templates render, so we are not parking customer PII in
    // enrolment context we do not need.
    const items = (Array.isArray(checkout.line_items) ? checkout.line_items : [])
      .slice(0, 8)
      .map((li: any) => ({
        title: String(li?.title ?? li?.name ?? "Item"),
        quantity: Number(li?.quantity ?? 1),
        price: Number(li?.price ?? 0),
      }));
    await enrolEmailFlow("checkout_abandoned", {
      email,
      entityRef: token,
      dedupPrefix: "abandoned",
      firstName: nm,
      context: {
        checkout_url: rUrl,
        items,
        total: Number(checkout.total_price ?? 0),
      },
    });
  } catch (e) {
    console.warn("[shopify-wa] email cart enrol:", e);
  }

  const waId = toWaId(
    checkout.phone ?? checkout.customer?.phone ?? checkout.shipping_address?.phone ?? checkout.billing_address?.phone,
  );
  if (!waId) return;

  // Dashboard settings (Flows tab): kill-switch + step delays + deadline + coupon.
  const flows = await getFlowSettings();

  const name = firstName(checkout.customer?.first_name, checkout.shipping_address?.first_name);
  // The third-party checkout partner (sales channel SMB-1CCO) skips the native
  // Shopify checkout, so `abandoned_checkout_url` points at a cart the customer
  // can't actually complete. The partner instead drops its OWN recovery URL into
  // the order note — a /cart/?atomsSt=<token>&bzCartRec=true link. Always prefer
  // that note URL; the token rehydrates the partner cart on tap. Only fall back
  // to Shopify's native URL (then /cart) when the note carries no link.
  const noteUrl = noteCheckoutUrl(checkout);
  // Normalise onto the brand domain. The note URL arrives on the raw
  // a1e4f4-2.myshopify.com host, which we then sent verbatim in the free-text
  // recovery path — the customer saw a myshopify.com link while the template
  // path (base https://promunch.in/{{1}}) showed promunch.in for the same cart.
  // Same store, same path, so rebasing is safe and makes both paths identical.
  const recoverUrl: string = brandUrl(
    noteUrl || checkout.abandoned_checkout_url || `${SITE_URL}/cart`,
  );

  // User-created flows on this trigger (own atomic claim per flow+checkout;
  // independent of the built-in cart flow's toggle and enrol gate).
  await enrolCustomFlows("checkout_abandoned", { waId, name, entityRef: token, checkoutUrl: recoverUrl })
    .catch((e) => console.warn("[shopify-wa] custom enrol (checkout):", e));

  if (!flows.abandoned_cart_enabled) return;

  // ATOMIC gate #1, per CART — two checkouts/create+update webhooks for the same
  // token could both pass the select-based dedup below and enrol the sequence
  // twice. claimSend makes enrolment for a given cart happen exactly once.
  // (Gate #2, per CUSTOMER, is further down — this one alone is not enough,
  // because Shopify mints a new token for every fresh abandonment.)
  const enrolKey = `abandoned_enrol:${token}`;
  if (!(await claimSend(enrolKey))) return;
  // secondary guard — already enrolled before this gate existed? lock and stop.
  const { data: prior } = await sb.from("wa_journey_runs").select("id").eq("order_ref", token).limit(1);
  if (prior && prior.length) { await markSendSent(enrolKey); return; }

  await logConnector({
    connector: "shopify_wa", level: "info", event: "abandoned_recover_url",
    message: `Cart ${token}: recovery link from ${noteUrl ? "note" : (checkout.abandoned_checkout_url ? "shopify_url" : "fallback")}.`,
    ref: token,
  }).catch(() => {});
  // Coupon comes from the dashboard (Flows tab); defaults to PROMUNCH10 (10%
  // off on orders ₹399+, the only live code — PROTEIN15 discontinued 2026-06).
  const code = (flows.cart_coupon_code || "PROMUNCH10").trim();

  // Both templates carry a dynamic URL button: base https://promunch.in/{{1}}.
  // We fill {{1}} with a path suffix that gets appended to that base.
  //
  // Each step's landing URL is UTM-stamped so recovered revenue is measurable.
  // Until now cart links carried no tracking at all: the dashboard could not
  // tell "message never delivered" from "delivered and ignored", and a customer
  // who tapped through and bought was indistinguishable from one who wandered
  // back on their own. shopify-orders-backfill already reads UTM tags off
  // customerJourneySummary into shopify_orders, so stamping here is enough to
  // attribute the order end to end.
  const reminderTarget = withUtm(recoverUrl, "cart_reminder");
  const couponTarget = withUtm(recoverUrl, "cart_coupon");

  // Step 1 (reminder, NO coupon): {{1}} is the bare recovery-checkout path, so
  // tapping "Complete Order" drops the customer straight back on their cart —
  // full price, no discount given away yet. Strip the leading slash to avoid a
  // double slash against the template's base URL.
  const reminderSuffix = pathOf(reminderTarget).replace(/^\//, "");
  const reminderComponents = [
    { type: "body", parameters: [{ type: "text", text: name }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: reminderSuffix }] },
  ];

  // Step 2 (recovery, WITH coupon): {{1}} is a Shopify discount link —
  // /discount/<code>?redirect=<recovery checkout> — so tapping it applies the
  // coupon AND drops the customer on their own cart, discount already on.
  const discountSuffix = `discount/${code}?redirect=${encodeURIComponent(pathOf(couponTarget))}`;
  const discountComponents = [
    { type: "body", parameters: [{ type: "text", text: name }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: discountSuffix }] },
  ];

  // 2-message sequence within the first 6h — NO duplicate sends:
  //   +1h  reminder, no coupon (just the checkout link)
  //   +6h  PROMUNCH10 coupon — only if they haven't ordered by then
  // We used to fire a THIRD touch at +24h that re-sent the SAME recovery
  // template verbatim. Two identical "special discount" messages read as spam
  // and break the no-double-message invariant, so that step was removed.
  // Each step carries its own template name in context (wa-journey-tick reads
  // context.template, falling back to the journey default). The whole sequence
  // stops early once the customer orders: orders/create flips active runs to
  // 'converted', so they never get a nudge after buying.
  // Full tappable URLs for the cap-immune FREE-TEXT recovery path (wa-journey-tick
  // delivers these when the customer's 24h window is open, dodging #131049). The
  // template path uses the path-suffix components above; the free-text path needs
  // the whole https URL. vars["1"]=name, vars["2"]=link, matching callProactiveAsk.
  const reminderUrl = reminderTarget;
  const discountUrl = `${SITE_URL}/${discountSuffix}`;

  // All cart runs share one retry deadline: keep trying (free text in-window, or
  // spaced template) until ONE message is delivered or this passes (see migration
  // 20260627160000). Measured from enrolment so both steps expire together.
  const deadlineAt = new Date(Date.now() + flows.cart_deadline_hours * 3600_000).toISOString();

  // Delays measured from abandonment (dashboard-configurable; defaults +1h / +6h).
  const steps = [
    { h: flows.cart_step1_delay_hours, template: "abandoned_cart_reminder", components: reminderComponents, url: reminderUrl },
    { h: flows.cart_step2_delay_hours, template: "abandoned_cart_recovery", components: discountComponents, url: discountUrl },
  ];

  // Cart contents for the voice agent's spoken summary — title + qty only, no
  // price breakdown, nothing beyond what a courier already knows. Computed
  // fresh here (not reused from the email-flow `items` local above, which is
  // scoped to that try block and shaped differently for the email template).
  const voiceItems = (Array.isArray(checkout.line_items) ? checkout.line_items : [])
    .slice(0, 8)
    .map((li: any) => ({ title: String(li?.title ?? li?.name ?? "item"), qty: Number(li?.quantity ?? 1) }));
  const voiceTotal = Number(checkout.total_price ?? 0);

  // === ONE LIVE CART SEQUENCE PER CUSTOMER ==================================
  // enrolKey above is keyed on the Shopify CHECKOUT TOKEN, and Shopify mints a
  // BRAND-NEW token every time the same human comes back and abandons again. So
  // it correctly stopped one cart enrolling twice from duplicate webhooks, and
  // did nothing at all about one person being enrolled 2, 3, 4 times over, each
  // sequence nudging on its own independent schedule.
  //
  // Production proof (Aug 2026): a single contact held FOUR parallel
  // abandoned_checkout sequences and received four IDENTICAL marketing templates
  // in the same minute, repeating every 6h for 72h — 80 marketing sends in one
  // month. Across August: 537 cart marketing attempts to 35 distinct people.
  // That is a straight CLAUDE.md §0 never-message-twice violation, and it is
  // precisely what Meta's #131049 per-recipient marketing-fatigue cap punishes.
  //
  // The rule from here: at most ONE live abandoned_checkout sequence per wa_id.
  // A returning abandoner does NOT get a second sequence — the one they already
  // have is re-pointed at their newest cart, because the newest cart is the one
  // worth recovering.
  //
  // RACE SAFETY: "select active runs → none found → insert" is a read-then-write,
  // and two concurrent checkout webhooks for the same person both read "none"
  // and both insert. Exactly the class of race that double-confirmed order #2050.
  // So take an ATOMIC per-CUSTOMER claim first (claim_order_confirmation is a
  // single INSERT .. ON CONFLICT statement, so Postgres serialises contenders)
  // and hold it as a short mutex across the whole check-and-write. Unlike a send
  // claim this one is RELEASED, never marked 'sent': it is a critical section,
  // not a permanent lock — a customer is allowed a fresh sequence later, once
  // the current one has finished. A crashed holder frees itself after the claim
  // table's 10-minute stale window, so one crash cannot mute a customer forever.
  const customerKey = `abandoned_customer:${waId}`;
  if (!(await claimSend(customerKey))) {
    // Another webhook is enrolling/refreshing this same person right now. Bias
    // to silence (§0.5) and release the CART claim so a later checkouts/update
    // for this token can pick the work up cleanly instead of losing the cart.
    await releaseSend(enrolKey);
    await logConnector({
      connector: "shopify_wa", level: "info", event: "abandoned_enrol_busy",
      message: `Cart ${token}: another cart enrolment for ${waId} is in flight — standing down.`,
      ref: token,
    }).catch(() => {});
    return;
  }

  try {
    // Any live cart step for this HUMAN, regardless of which cart it came from.
    const { data: live, error: liveErr } = await sb.from("wa_journey_runs")
      .select("id, order_ref, context")
      .eq("wa_id", waId)
      .eq("journey_key", "abandoned_checkout")
      .eq("status", "active");
    if (liveErr) {
      // Unknown DB state — never guess in the direction of MORE messages.
      // Release the cart claim so a later checkouts/update retries cleanly.
      await releaseSend(enrolKey);
      console.warn("[shopify-wa] cart live-run lookup failed:", liveErr.message);
      return;
    }

    if (live && live.length) {
      // REFRESH IN PLACE — zero new rows, therefore zero extra messages. Re-point
      // the running steps at the newest cart's links (and its first name), matched
      // per step by context.template. Runs enrolled before per-step templates
      // existed carry no context.template; wa-journey-tick reads those as the
      // journey default (abandoned_cart_recovery), so match that here.
      const byTemplate = new Map(steps.map((s) => [s.template, s]));
      let refreshed = 0;
      for (const run of live) {
        const ctx = { ...((run.context ?? {}) as Record<string, unknown>) };
        // Voice row: re-point its spoken content at the newest cart, same as
        // the WA steps below, but keyed on its own template rather than
        // byTemplate (that map only knows the two WA steps). Schedule fields
        // stay untouched for the identical reason given below — refreshing
        // CONTENT must never re-arm the call's timing.
        if (ctx.template === VOICE_TEMPLATE) {
          const oldVars = (ctx.vars ?? {}) as Record<string, string>;
          const displayName = name === "there" ? (oldVars["1"] || name) : name;
          ctx.vars = { ...oldVars, "1": displayName, "2": reminderUrl };
          ctx.items = voiceItems;
          ctx.total = voiceTotal;
          ctx.coupon = code;
          const { error: vErr } = await sb.from("wa_journey_runs")
            .update({ context: ctx, order_ref: token })
            .eq("id", run.id).eq("status", "active");
          if (!vErr) refreshed++;
          continue;
        }
        const step = byTemplate.get(String(ctx.template ?? "abandoned_cart_recovery"));
        // Hand-edited or unrecognised step: leave it exactly as it is rather than
        // push a link into a template whose component shape we do not know.
        if (!step) continue;
        const oldVars = (ctx.vars ?? {}) as Record<string, string>;
        // firstName() falls back to "there" — don't downgrade a real name we
        // already captured just because the newest checkout carries no name.
        const displayName = name === "there" ? (oldVars["1"] || name) : name;
        ctx.components = step.components;
        ctx.vars = { ...oldVars, "1": displayName, "2": step.url };
        // DELIBERATELY NOT TOUCHED: next_action_at, deadline_at, attempts,
        // status, delivered_at. Refreshing the CONTENT must never re-arm the
        // SCHEDULE. Pulling next_action_at backwards would fire an extra nudge,
        // and extending deadline_at would let a serial abandoner be chased
        // indefinitely — abandon five carts, get chased five deadlines. The
        // ORIGINAL deadline stands: one sequence, one finite window, per person.
        const { error: upErr } = await sb.from("wa_journey_runs")
          .update({ context: ctx, order_ref: token })
          .eq("id", run.id).eq("status", "active");
        if (!upErr) refreshed++;
      }
      // This cart is fully accounted for — its links now live on the running
      // sequence, so it must never enrol a sequence of its own.
      await markSendSent(enrolKey);
      await logConnector({
        connector: "shopify_wa", level: "info", event: "abandoned_enrol_refreshed",
        message:
          `Cart ${token}: ${waId} already has a live recovery sequence — re-pointed ${refreshed} step(s) ` +
          `at the new cart instead of enrolling a second one (original deadline kept).`,
        ref: token,
      }).catch(() => {});
      return;
    }

    // Explicit context shape (rather than letting it fall out of the WA steps'
    // .map()) so the voice row below — which carries fields the WA steps don't
    // (channel, items, total, coupon) — type-checks without a cast.
    type CartJourneyContext = {
      template: string;
      channel?: string;
      language: string;
      components?: unknown;
      vars: Record<string, string>;
      items?: Array<{ title: string; qty: number }>;
      total?: number;
      coupon?: string;
    };
    const rows: Array<{
      journey_key: string;
      wa_id: string;
      next_action_at: string;
      deadline_at: string;
      context: CartJourneyContext;
      order_ref: string;
    }> = steps.map((s) => ({
      journey_key: "abandoned_checkout",
      wa_id: waId,
      next_action_at: new Date(Date.now() + s.h * 3600_000).toISOString(),
      deadline_at: deadlineAt,
      context: { template: s.template, language: "en", components: s.components, vars: { "1": name, "2": s.url } },
      order_ref: token,
    }));
    // Voice rescue step: due after WA step 2 + its own delay. wa-journey-tick
    // only dials it once WA has demonstrably failed (see
    // _shared/voice-eligibility.ts) — enrolling it here just reserves its slot
    // on the schedule, gated on the dashboard kill-switch like everything else
    // in this sequence. Ships OFF (voice_call_enabled defaults false), so this
    // is a no-op for everyone until the flag is turned on.
    if (flows.voice_call_enabled) {
      rows.push({
        journey_key: "abandoned_checkout",
        wa_id: waId,
        next_action_at: new Date(
          Date.now() + (flows.cart_step2_delay_hours + flows.cart_voice_delay_hours) * 3600_000,
        ).toISOString(),
        deadline_at: deadlineAt,
        context: {
          template: VOICE_TEMPLATE,
          channel: "voice",
          language: "en",
          vars: { "1": name, "2": reminderUrl },
          items: voiceItems,
          total: voiceTotal,
          coupon: code,
        },
        order_ref: token,
      });
    }
    const { error: insErr } = await sb.from("wa_journey_runs").insert(rows);
    if (insErr) {
      // 23505 = the per-customer partial unique index from migration
      // 20260826101000 caught a live sequence this call could not see. The
      // insert is a single statement, so nothing was half-written and the
      // customer is already covered: lock the cart claim and move on. Any other
      // error is a real failure — release the claim so a later checkouts/update
      // can retry rather than losing the cart entirely.
      const dup = String((insErr as { code?: string }).code ?? "") === "23505";
      if (dup) await markSendSent(enrolKey); else await releaseSend(enrolKey);
      await logConnector({
        connector: "shopify_wa",
        level: dup ? "info" : "error",
        event: dup ? "abandoned_enrol_dup" : "abandoned_enrol_failed",
        message: dup
          ? `Cart ${token}: ${waId} already has a live recovery sequence (unique index) — not enrolling a second.`
          : `Cart ${token}: cart enrolment insert failed — ${insErr.message}.`,
        ref: token,
      }).catch(() => {});
      return;
    }
    await markSendSent(enrolKey); // lock — never re-enrol this cart
  } finally {
    // Always hand the per-customer mutex back: critical section, not a lock.
    // (releaseSend only deletes claims that are not 'sent', so it can never
    // unlock a genuine send claim that happens to share the key space.)
    await releaseSend(customerKey);
  }
}

// --- tracking link resolution ----------------------------------------------
//
// We have NO trusted carrier tracking feed yet (Shree Maruti API integration is
// still pending). Shopify's fulfillment.tracking_url and guessed carrier deep
// links both proved unreliable: for some carriers the URL is just the carrier
// HOMEPAGE with no AWB, and a constructed Amazon link
// (track.amazon.com/tracking/<awb>) went out for order #2056 and did not
// resolve to a real shipment.
//
// Policy until a carrier API is wired up: ALWAYS send the Shopify order-status
// page. It is always valid and automatically surfaces the live carrier + AWB
// once the courier scans the parcel — so the customer can always track, and we
// never ship a broken or guessed link again.
function resolveTrackingUrl(_f: any, order: any): string {
  const statusUrl = String(order?.order_status_url ?? "").trim();
  return statusUrl || SITE_URL;
}

// --- helpers ----------------------------------------------------------------

// An order is "active" (worth messaging the customer about) when it is not
// cancelled and not voided/refunded.
function orderIsActive(order: any): boolean {
  if (order?.cancelled_at) return false;
  const fin = String(order?.financial_status ?? "").toLowerCase();
  return fin !== "voided" && fin !== "refunded";
}
function orderState(order: any): string {
  if (order?.cancelled_at) return "cancelled";
  const fin = String(order?.financial_status ?? "").toLowerCase();
  return fin === "voided" || fin === "refunded" ? fin : "active";
}

// Send via the wa-send edge function, retrying transient failures.
//
// This webhook always returns 200 (Shopify retries non-2xx aggressively), so
// Shopify never re-delivers on our behalf — a failed send here is final.
// A missed order confirmation is worse than a rare duplicate attempt, so we
// retry 3x with short backoff. ok:false means Meta did NOT accept the message,
// so a retry sends nothing twice; the wa-confirmation-sweep cron is the final
// backstop for anything that still fails all 3 tries.
async function callWaSend(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
  let last: { ok?: boolean; error?: string } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await callWaSendOnce(body);
    if (last?.ok) return last;
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 750));
  }
  return last;
}

async function callWaSendOnce(body: unknown): Promise<{ ok?: boolean; error?: string } | null> {
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
