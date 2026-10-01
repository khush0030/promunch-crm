// Email flow engine — the email twin of the WhatsApp wa-journey-tick machine.
//
// Drains due flow_enrollments and sends the current step. The atomic claim is an
// insert into email_sends under the (enrollment_id, step_index) partial-unique
// index: if the row already exists the step was already sent, so we skip and
// advance (never email a customer twice, AGENTS.md §4.1). Nothing here sends
// until a flow is set status='active' AND the email-flow-tick cron runs.
//
// Send guards (all evaluated BEFORE the claim insert, so a deferral never
// creates, consumes or releases a claim, and never counts as an attempt):
//   - quiet hours: steps only go out 09:00-21:00 IST, else next 09:xx IST
//   - frequency cap: no step if the contact got another marketing email
//     (other flow or any campaign) within EMAIL_FREQ_CAP_HOURS (default 16h);
//     the step is deferred to when the window clears, never skipped. The first
//     abandoned-cart email bypasses by default (see send-guards.ts).
// The cap is a soft guard (two concurrent ticks could both pass it); the
// never-twice guarantee is still the email_sends claim below.

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendEmail, DEFAULT_FROM } from "@/lib/resend";
import { renderMarketingEmail } from "./layout";
import { renderPlainMarketingEmail } from "./plain-layout";
import { marketingHeaders, unsubscribeUrl } from "./unsubscribe";
import { getOrCreateFlowCoupon } from "./coupons";
import type { FlowStep } from "./flow-templates";
import {
  bypassesFreqCap,
  computeSendDeferral,
  couponProblem,
  enrolmentRefs,
  lastOtherMarketingAt,
  toWaId,
  variantFor,
  WA_JOURNEY_KEYS,
  waJourneyOverlap,
  withFromName,
  type RecentSend,
  type WaJourneyKind,
  type WaJourneyRunRow,
} from "./send-guards";
import { getFreqCapHours, recentMarketingSends } from "@/lib/email-studio/audience-server";
import { personalize, personalizeSubject } from "./personalize";
import { needsImageLookup, type ImageLookup } from "./cart-items";
import { tokenizeStorefrontLinks } from "./link-tokens";
import { withContactToken } from "./browse-abandon";
import { loadStoreCatalog, pickReviewProduct, usesReviewTokens } from "./order-product";

const BATCH = 200;
const PAGE = 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_HOURS = 6;
const PAUSE_DEFER_HOURS = 6;
/** Retry spacing when an offer step has no usable coupon code. */
const COUPON_RETRY_HOURS = 1;
/** Re-check spacing when the WhatsApp overlap lookup itself fails. */
const WA_OVERLAP_ERROR_DEFER_HOURS = 1;

/** Thrown before sendEmail when an offer email would go out without its code. */
class CouponUnavailableError extends Error {}

/**
 * Did WhatsApp already send this customer the matching journey? Returns the
 * overlap (skip), null (send), or "error" (lookup failed: defer, do not send).
 */
async function waOverlapFor(
  kind: WaJourneyKind,
  phone: string | null | undefined,
  context: Record<string, unknown> | null,
): Promise<{ ref: string } | null | "error"> {
  const waId = toWaId(phone);
  if (!waId) return null; // no phone on file → WhatsApp can't have reached them via a journey we can see
  const { data, error } = await supabase
    .from("wa_journey_runs")
    .select("journey_key, status, order_ref, delivered_at, updated_at, next_action_at")
    .eq("wa_id", waId)
    .eq("journey_key", WA_JOURNEY_KEYS[kind])
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[email-flow-tick] wa_journey_runs lookup failed:", error.message);
    return "error";
  }
  return waJourneyOverlap({ kind, runs: (data ?? []) as WaJourneyRunRow[], refs: enrolmentRefs(context), now: new Date() });
}

type Enrollment = {
  id: string;
  flow_id: string;
  contact_id: string;
  current_step: number;
  context: Record<string, unknown> | null;
  deadline_at: string | null;
  attempts: number | null;
};

export type FlowTickResult = {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  completed: number;
  cancelled: number;
  /** Steps pushed later by quiet hours / frequency cap (not attempts). */
  deferred: number;
};

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

async function fetchSuppressedSet(): Promise<Set<string>> {
  const set = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("suppressions")
      .select("email")
      .order("email", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) set.add((r.email as string).toLowerCase());
    if (rows.length < PAGE) break;
  }
  return set;
}

async function setStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
  await supabase
    .from("flow_enrollments")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

async function advance(e: Enrollment, steps: FlowStep[]) {
  const next = e.current_step + 1;
  if (next >= steps.length) {
    await setStatus(e.id, "completed", { current_step: next, completed_at: new Date().toISOString() });
  } else {
    await supabase
      .from("flow_enrollments")
      .update({
        current_step: next,
        next_action_at: hoursFromNow(steps[next].delay_hours || 0),
        attempts: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", e.id);
  }
}

/**
 * Product images for cart items, from the Shopify catalog mirror
 * (wa_catalog_items; retailer_id == Shopify variant id). Keyed by variant id
 * and by lowercased product/variant title, since the cart context written by
 * shopify-wa only carries titles today. Non-fatal: no images on error.
 */
async function loadCatalogImages(): Promise<ImageLookup> {
  const map: ImageLookup = new Map();
  const { data, error } = await supabase
    .from("wa_catalog_items")
    .select("retailer_id, title, product_title, image_url")
    .not("image_url", "is", null)
    .limit(1000);
  if (error) return map;
  for (const r of (data ?? []) as Array<{ retailer_id: string | null; title: string | null; product_title: string | null; image_url: string | null }>) {
    if (!r.image_url) continue;
    if (r.retailer_id) map.set(String(r.retailer_id), r.image_url);
    for (const t of [r.product_title, r.title]) {
      const k = String(t ?? "").trim().toLowerCase();
      if (k && !map.has(k)) map.set(k, r.image_url);
    }
  }
  return map;
}

/** Insert the claim row; retries without `variant` if migration 20260930110000 isn't applied yet. */
async function insertClaim(row: Record<string, unknown>) {
  let { error } = await supabase.from("email_sends").insert(row);
  if (error && "variant" in row && /variant/i.test(error.message) && error.code !== "23505") {
    const { variant: _drop, ...rest } = row;
    void _drop;
    ({ error } = await supabase.from("email_sends").insert(rest));
  }
  return error;
}

export async function tick(): Promise<FlowTickResult> {
  const res: FlowTickResult = { scanned: 0, sent: 0, skipped: 0, failed: 0, completed: 0, cancelled: 0, deferred: 0 };
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: due, error } = await supabase
    .from("flow_enrollments")
    .select("id, flow_id, contact_id, current_step, context, deadline_at, attempts")
    .eq("status", "active")
    .lte("next_action_at", nowIso)
    .order("next_action_at", { ascending: true })
    .limit(BATCH);

  if (error) throw new Error(error.message);
  if (!due || due.length === 0) return res;

  const flowIds = [...new Set(due.map((e) => e.flow_id))];
  const { data: flowRows } = await supabase
    .from("flows")
    .select("id, status, steps, trigger_type")
    .in("id", flowIds);
  const flows = new Map((flowRows ?? []).map((f) => [f.id, f]));

  const suppressed = await fetchSuppressedSet();

  // Frequency-cap state for this batch. A read failure throws (nothing sends
  // this tick; the cron retries): when in doubt, do not send.
  const capHours = await getFreqCapHours();
  const recentByContact = new Map<string, RecentSend[]>();
  if (capHours > 0) {
    const since = new Date(now.getTime() - capHours * 3_600_000).toISOString();
    const rows = await recentMarketingSends(since, due.map((e) => e.contact_id as string));
    for (const r of rows) {
      const list = recentByContact.get(r.contact_id) ?? [];
      list.push(r);
      recentByContact.set(r.contact_id, list);
    }
  }

  let catalogImages: ImageLookup | null = null;

  for (const e of due as Enrollment[]) {
    res.scanned++;
    const flow = flows.get(e.flow_id);

    if (!flow) {
      await setStatus(e.id, "cancelled", { last_error: "flow deleted" });
      res.cancelled++;
      continue;
    }
    // Paused/draft flow: keep the enrolment, try again later.
    if (flow.status !== "active") {
      await supabase
        .from("flow_enrollments")
        .update({ next_action_at: hoursFromNow(PAUSE_DEFER_HOURS), updated_at: new Date().toISOString() })
        .eq("id", e.id);
      continue;
    }
    // Deadline (e.g. abandoned cart 72h): stop trying.
    if (e.deadline_at && new Date(e.deadline_at).getTime() < Date.now()) {
      await setStatus(e.id, "exited", { last_error: "deadline passed" });
      continue;
    }

    const steps: FlowStep[] = Array.isArray(flow.steps) ? (flow.steps as FlowStep[]) : [];
    const step = steps[e.current_step];
    if (!step) {
      await setStatus(e.id, "completed", { completed_at: new Date().toISOString() });
      res.completed++;
      continue;
    }

    // Eligibility: reachable, still subscribed, not suppressed.
    const { data: contact } = await supabase
      .from("contacts")
      .select("email, phone, first_name, status, accepts_marketing")
      .eq("id", e.contact_id)
      .maybeSingle();
    const email = (contact?.email as string | undefined)?.toLowerCase();
    if (!email || contact?.status !== "active" || contact?.accepts_marketing === false || suppressed.has(email)) {
      await setStatus(e.id, "cancelled", { last_error: "contact not marketable" });
      res.cancelled++;
      continue;
    }

    // WhatsApp overlap: if WA already sent this customer the same ask (review /
    // replenishment / cart), skip this email step and move on. No claim row is
    // written (email_sends.status allows only queued/sent/failed). A lookup
    // error defers the step (when in doubt, do not send).
    if (step.skip_if_wa_journey && WA_JOURNEY_KEYS[step.skip_if_wa_journey]) {
      const overlap = await waOverlapFor(step.skip_if_wa_journey, contact?.phone as string | null, e.context);
      if (overlap === "error") {
        await supabase
          .from("flow_enrollments")
          .update({ next_action_at: hoursFromNow(WA_OVERLAP_ERROR_DEFER_HOURS), updated_at: new Date().toISOString() })
          .eq("id", e.id)
          .eq("status", "active")
          .eq("current_step", e.current_step);
        res.deferred++;
        continue;
      }
      if (overlap) {
        console.info(
          `[email-flow-tick] skip enrolment ${e.id} step ${e.current_step}: WhatsApp ${step.skip_if_wa_journey} already sent (${overlap.ref})`,
        );
        await advance(e, steps);
        res.skipped++;
        continue;
      }
    }

    // Send guards, BEFORE the claim: quiet hours + frequency cap. A deferral
    // only moves next_action_at; attempts and the claim ledger are untouched.
    const deferral = computeSendDeferral({
      now: new Date(),
      lastOtherMarketingAt: lastOtherMarketingAt(recentByContact.get(e.contact_id), { enrollmentId: e.id }),
      capHours,
      bypassCap: bypassesFreqCap(step, flow.trigger_type as string | null, e.current_step),
      jitterKey: `${e.id}:${e.current_step}`,
    });
    if (deferral) {
      await supabase
        .from("flow_enrollments")
        .update({ next_action_at: deferral.until.toISOString(), updated_at: new Date().toISOString() })
        .eq("id", e.id)
        .eq("status", "active")
        .eq("current_step", e.current_step);
      res.deferred++;
      continue;
    }

    const { variant, tested } = variantFor(step, e.id, e.current_step);

    // Atomic claim: insert the step's ledger row. Unique violation = this step
    // was already sent (or is in flight) → skip + advance. Any OTHER error is
    // not proof of a send: leave the enrolment due and retry next tick.
    const claimErr = await insertClaim({
      enrollment_id: e.id,
      flow_id: e.flow_id,
      step_index: e.current_step,
      contact_id: e.contact_id,
      email,
      status: "queued",
      ...(tested ? { variant: variant.label } : {}),
    });
    if (claimErr) {
      if (claimErr.code === "23505") {
        await advance(e, steps);
        res.skipped++;
      } else {
        console.error("[email-flow-tick] claim insert failed:", claimErr.message);
        res.failed++;
      }
      continue;
    }
    // Count the claim toward the cap right away, so a second enrolment for
    // the same contact later in this batch (cart + welcome) is deferred.
    const list = recentByContact.get(e.contact_id) ?? [];
    list.push({ contact_id: e.contact_id, at: Date.now(), enrollment_id: e.id });
    recentByContact.set(e.contact_id, list);

    try {
      const first = (contact?.first_name as string | null) ?? null;
      // Unique per-enrolment code when the step asks for one; the static
      // coupon_code is the fallback (getOrCreateFlowCoupon never throws). With
      // no fallback a failed mint returns "", which couponProblem() below
      // catches before anything is sent.
      const coupon = step.coupon && Number(step.coupon.percent_off) > 0
        ? await getOrCreateFlowCoupon({
            enrollmentId: e.id,
            stepIndex: e.current_step,
            contactEmail: email,
            percentOff: Number(step.coupon.percent_off),
            expiresInDays: Number(step.coupon.expires_in_days ?? 7) || 7,
            fallbackCode: step.coupon_code ?? "",
            prefix: step.coupon.prefix,
          })
        : step.coupon_code ?? "";

      if (/\{\{\s*cart_items\s*\}\}/.test(step.body_html) && needsImageLookup(e.context) && !catalogImages) {
        catalogImages = await loadCatalogImages().catch(() => new Map<string, string>());
      }
      // Review emails: resolve the product they bought (public catalog,
      // cached) so {{review_url}} lands on that product's Judge.me reviews.
      let ctx = e.context;
      if (usesReviewTokens(step.body_html, variant.subject, variant.preview_text)) {
        const catalog = await loadStoreCatalog();
        ctx = { ...(e.context ?? {}), review_product: pickReviewProduct(e.context, catalog) };
      }
      const bodyHtml = personalize(
        step.body_html, ctx, first, e.current_step, coupon, catalogImages ?? undefined,
        Number(step.coupon?.percent_off ?? 0),
      );
      const previewText = variant.preview_text
        ? personalizeSubject(variant.preview_text, ctx, first, coupon)
        : undefined;
      const rendered = step.format === "plain"
        ? renderPlainMarketingEmail({
            unsubscribeUrl: unsubscribeUrl(e.contact_id),
            bodyHtml,
            previewText,
            signature: step.signature,
          })
        : renderMarketingEmail({ contactId: e.contact_id, bodyHtml, previewText });
      // Storefront links carry the signed pm_c token so the pixel can identify
      // a click-through shopper (browse abandonment). Unsubscribe is untouched.
      const html = tokenizeStorefrontLinks(rendered, (u) => withContactToken(u, e.contact_id));
      const subject = personalizeSubject(variant.subject, ctx, first, coupon);
      // Coupon safety, AFTER the claim and BEFORE any send: an offer email with
      // no code (mint failed, no static fallback) or a raw {{coupon_code}} tag
      // never goes out. The catch below fails the queued claim (re-claimable)
      // and retries in COUPON_RETRY_HOURS; MAX_ATTEMPTS then fails the enrolment.
      const couponIssue = couponProblem({ step, coupon, rendered: { subject, html, previewText } });
      if (couponIssue) throw new CouponUnavailableError(couponIssue);
      const r = await sendEmail({
        to: contact!.email as string,
        subject,
        html,
        from: withFromName(DEFAULT_FROM, step.from_name),
        headers: marketingHeaders(e.contact_id),
      });
      const resendId = r?.data?.id;
      if (r?.error || !resendId) throw new Error(r?.error?.message ?? "send failed");

      await supabase
        .from("email_sends")
        .update({ status: "sent", resend_id: resendId, sent_at: new Date().toISOString() })
        .eq("enrollment_id", e.id)
        .eq("step_index", e.current_step)
        .eq("status", "queued");
      res.sent++;
      await advance(e, steps);
    } catch (err) {
      const couponFail = err instanceof CouponUnavailableError;
      const msg = err instanceof Error ? err.message : "send error";
      // Fail the queued claim so a retry can re-insert (row leaves the index).
      // Only rows still 'queued' are touched, so a step that did send is never
      // reopened.
      await supabase
        .from("email_sends")
        .update({ status: "failed", error: msg })
        .eq("enrollment_id", e.id)
        .eq("step_index", e.current_step)
        .eq("status", "queued");
      if (couponFail) {
        // Nothing went out: drop this batch's cap entry for the enrolment so a
        // sibling enrolment for the same contact is not deferred by a non-send.
        const mine = recentByContact.get(e.contact_id);
        if (mine) recentByContact.set(e.contact_id, mine.filter((s) => s.enrollment_id !== e.id));
      }
      const attempts = (e.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await setStatus(e.id, "failed", { last_error: couponFail ? "coupon unavailable" : msg, attempts });
      } else {
        await supabase
          .from("flow_enrollments")
          .update({
            attempts,
            next_action_at: hoursFromNow(couponFail ? COUPON_RETRY_HOURS : BACKOFF_HOURS),
            last_error: msg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", e.id);
      }
      res.failed++;
    }
  }

  return res;
}
