// App-side email-flow enrolment + exit rules: the Next twin of the edge
// promunch-email-agent/supabase/functions/_shared/email-flows.ts. Used by the
// public opt-in route (welcome flow) and the app-side segment / browse crons.
// DB-only: the email-flow-tick cron does the sending.
//
// Keep everything from "Pure rules" down in step with the edge twin; the only
// intended difference is contactIdForEmail (lookup-only here, the edge upserts
// a checkout-only shopper). enroll.test.ts asserts the pure rules agree.
//
// Public API (backward compatible; callers may ignore the return value):
//   enrollEmailFlow(trigger, { email, entityRef, dedupPrefix, firstName?,
//                              context?, flowId?, orderId? }) -> Promise<number>
//   `flowId` targets one specific flow (segment_entry flows share a trigger).

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const db = () => supabase;

// ============================================================================
// Pure rules (no DB). Mirrored in src/lib/email/enroll.ts.
// ============================================================================

export type FlowLike = {
  id: string;
  trigger_type?: string | null;
  steps: unknown;
  trigger_config: Record<string, unknown> | null;
};

export type PriorOrderRow = {
  shopify_id?: string | number | null;
  order_number?: string | null;
  cancelled_at?: string | null;
  financial_status?: string | null;
  is_creator?: boolean | null;
};

/** Dedup prefix whose enrolments are limited to one ACTIVE per (flow, contact).
 *  Must match the predicate of idx_flow_enrollments_one_active_cart. */
export const SINGLE_ACTIVE_PREFIX = "abandoned";

export function flowSteps(flow: FlowLike): Array<{ delay_hours?: number }> {
  return Array.isArray(flow.steps) ? (flow.steps as Array<{ delay_hours?: number }>) : [];
}

/** Every flow with at least one step, optionally narrowed to one flow id. */
export function selectFlowsForEnrol<T extends FlowLike>(flows: T[], flowId?: string | null): T[] {
  return flows.filter((f) => flowSteps(f).length > 0 && (!flowId || f.id === flowId));
}

export function isFirstOrderOnly(flow: FlowLike): boolean {
  return (flow.trigger_config ?? {}).first_order_only === true;
}

export function isSingleActivePerContact(trigger: string, dedupPrefix: string): boolean {
  return trigger === "checkout_abandoned" || dedupPrefix === SINGLE_ACTIVE_PREFIX;
}

/** Does placing an order end this flow's active enrolments? trigger_config
 *  .exit_on_order (boolean) wins; otherwise cart, welcome and segment_entry
 *  (win-back, browse, second-purchase, sunset...) flows exit on an order. */
export function exitsOnOrder(flow: FlowLike): boolean {
  const v = (flow.trigger_config ?? {}).exit_on_order;
  if (typeof v === "boolean") return v;
  return ["checkout_abandoned", "customer_created", "segment_entry"].includes(String(flow.trigger_type ?? ""));
}

/** Does starting a checkout end this flow's active enrolments (the cart flow
 *  takes over)? trigger_config.exit_on_checkout wins; default = welcome only.
 *  A cart flow never exits on a checkout (that is its own trigger). */
export function exitsOnCheckout(flow: FlowLike): boolean {
  if (flow.trigger_type === "checkout_abandoned") return false;
  const v = (flow.trigger_config ?? {}).exit_on_checkout;
  if (typeof v === "boolean") return v;
  return flow.trigger_type === "customer_created";
}

/** True when the customer already has a real (non-cancelled, non-voided,
 *  non-refunded, non-creator-seed) order OTHER than the current one. */
export function hasPriorOrder(
  rows: PriorOrderRow[],
  current: { orderId?: string | number | null; orderRef?: string | null },
): boolean {
  return rows.some((r) => {
    if (r.cancelled_at) return false;
    const fin = String(r.financial_status ?? "").toLowerCase();
    if (fin === "voided" || fin === "refunded") return false;
    if (r.is_creator) return false;
    if (current.orderId != null && r.shopify_id != null && String(r.shopify_id) === String(current.orderId)) return false;
    if (current.orderRef && r.order_number === current.orderRef) return false;
    return true;
  });
}

export function dedupKeyFor(
  flow: FlowLike,
  opts: { dedupPrefix: string; entityRef: string },
  contactId: string,
): string {
  // first_order_only: one enrolment per contact per flow, ever.
  if (isFirstOrderOnly(flow)) return `${opts.dedupPrefix}:first:${contactId}`;
  return `${opts.dedupPrefix}:${opts.entityRef}`;
}

export function tokenFromDedupKey(key: string | null | undefined, prefix = SINGLE_ACTIVE_PREFIX): string | null {
  const k = String(key ?? "");
  return k.startsWith(`${prefix}:`) ? k.slice(prefix.length + 1) || null : null;
}

/** Merge a newer checkout into a running cart enrolment's context. Newer cart
 *  data wins, but an empty/missing value never wipes an existing one. Every
 *  checkout token seen is remembered so the order that later comes from ANY of
 *  them converts this enrolment. */
export function mergeCartContext(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
  token: string,
  existingDedupKey?: string | null,
): Record<string, unknown> {
  const prev = existing ?? {};
  const out: Record<string, unknown> = { ...prev };
  const incomingItemsEmpty = Array.isArray(incoming.items) && incoming.items.length === 0;
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null || v === undefined || v === "") continue;
    if (incomingItemsEmpty && (k === "items" || k === "total")) continue;
    out[k] = v;
  }
  const seen: string[] = [];
  const add = (t: unknown) => {
    const s = String(t ?? "").trim();
    if (s && !seen.includes(s)) seen.push(s);
  };
  add(tokenFromDedupKey(existingDedupKey));
  if (Array.isArray(prev.checkout_tokens)) prev.checkout_tokens.forEach(add);
  else add(prev.checkout_token);
  add(token);
  out.checkout_token = token;
  out.checkout_tokens = seen.slice(-20);
  return out;
}

/** Push a deadline out to now + hours, never pull it in. */
export function extendedDeadline(
  existingIso: string | null | undefined,
  deadlineHours: number | null,
  nowMs = Date.now(),
): string | null {
  if (!deadlineHours) return existingIso ?? null;
  const next = nowMs + deadlineHours * 3_600_000;
  const cur = existingIso ? new Date(existingIso).getTime() : NaN;
  return new Date(Number.isFinite(cur) && cur > next ? cur : next).toISOString();
}

/** Escape LIKE/ILIKE wildcards so an email matches literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ============================================================================
// DB orchestration (app).
// ============================================================================

type FlowRow = FlowLike & { status?: string };
type EnrolRow = { id: string; status: string; context: Record<string, unknown> | null; deadline_at: string | null; dedup_key: string | null };

export type EnrolOpts = {
  email?: string | null;
  entityRef: string;
  dedupPrefix: string;
  firstName?: string | null;
  context?: Record<string, unknown>;
  /** Target exactly one flow (segment_entry flows share a trigger). */
  flowId?: string | null;
  /** Shopify order id, used to exclude the current order in first_order_only. */
  orderId?: string | number | null;
};

async function activeFlowsFor(trigger: string): Promise<FlowRow[]> {
  const { data, error } = await db()
    .from("flows")
    .select("id, trigger_type, steps, trigger_config")
    .eq("trigger_type", trigger)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`flows lookup: ${error.message}`);
  return (data ?? []) as FlowRow[];
}

// App side never creates contacts: the opt-in route / segment crons upsert the
// contact first, so enrolment is lookup-only (as before).
async function contactIdForEmail(email: string): Promise<string | null> {
  return lookupContactId(email);
}

/**
 * Pick one contact for an email from case-insensitive matches. contacts.email
 * is UNIQUE but case-sensitive, so "Foo@x.com" and "foo@x.com" can both exist:
 * prefer the lowercase row, else the first row returned (oldest).
 */
export function pickContactId(rows: Array<{ id: unknown; email?: unknown }> | null | undefined, email: string): string | null {
  const list = rows ?? [];
  if (list.length === 0) return null;
  const lc = email.trim().toLowerCase();
  const exact = list.find((r) => String(r.email ?? "") === lc);
  return String((exact ?? list[0]).id);
}

/** Case-insensitive contact lookup (stored emails may be mixed-case). */
async function lookupContactId(email?: string | null): Promise<string | null> {
  const e = email?.trim().toLowerCase();
  if (!e) return null;
  const { data } = await db()
    .from("contacts")
    .select("id, email")
    .ilike("email", escapeLike(e))
    .order("created_at", { ascending: true })
    .limit(10);
  return pickContactId(data as Array<{ id: unknown; email?: unknown }> | null, e);
}

/** Bias to silence: a lookup error counts as "has a prior order". */
async function priorOrderExists(email: string, opts: EnrolOpts): Promise<boolean> {
  const { data, error } = await db()
    .from("shopify_orders")
    .select("shopify_id, order_number, cancelled_at, financial_status, is_creator")
    .ilike("customer_email", escapeLike(email))
    .limit(50);
  if (error) {
    console.warn("[email-flows] prior-order lookup failed, skipping first-order flow:", error.message);
    return true;
  }
  return hasPriorOrder((data ?? []) as PriorOrderRow[], { orderId: opts.orderId, orderRef: opts.entityRef });
}

function isUniqueViolation(err: { code?: string } | null | undefined): boolean {
  return err?.code === "23505";
}

async function insertEnrolment(row: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await db()
    .from("flow_enrollments")
    .upsert(row, { onConflict: "flow_id,dedup_key", ignoreDuplicates: true })
    .select("id");
  if (error) {
    if (isUniqueViolation(error)) return false;
    throw new Error(`enrol insert: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

async function refreshCart(existing: EnrolRow, incoming: Record<string, unknown>, token: string, deadlineHours: number | null): Promise<boolean> {
  const { error } = await db()
    .from("flow_enrollments")
    .update({
      // current_step / next_action_at / dedup_key deliberately untouched:
      // a refresh must never re-send a step that already went out.
      context: mergeCartContext(existing.context, incoming, token, existing.dedup_key),
      deadline_at: extendedDeadline(existing.deadline_at, deadlineHours),
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("status", "active");
  if (error) throw new Error(`cart refresh: ${error.message}`);
  return true;
}

const ENROL_COLS = "id, status, context, deadline_at, dedup_key";

async function findActiveSingle(flowId: string, contactId: string, prefix: string): Promise<EnrolRow | null> {
  const { data, error } = await db()
    .from("flow_enrollments")
    .select(ENROL_COLS)
    .eq("flow_id", flowId)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .like("dedup_key", `${prefix}:%`)
    .order("entered_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`active cart lookup: ${error.message}`);
  return (data?.[0] as EnrolRow | undefined) ?? null;
}

async function enrolSingleActive(
  flow: FlowRow,
  contactId: string,
  dedupKey: string,
  token: string,
  prefix: string,
  context: Record<string, unknown>,
  firstDelayHours: number,
  deadlineHours: number | null,
): Promise<boolean> {
  const sb = db();
  // 1. This exact checkout already enrolled? Active → refresh; finished → never re-enrol.
  const { data: same, error: e1 } = await sb
    .from("flow_enrollments").select(ENROL_COLS)
    .eq("flow_id", flow.id).eq("dedup_key", dedupKey).maybeSingle();
  if (e1) throw new Error(`cart dedup lookup: ${e1.message}`);
  if (same) return (same as EnrolRow).status === "active" ? refreshCart(same as EnrolRow, context, token, deadlineHours) : false;

  // 2. This checkout already merged into another enrolment of this contact?
  const { data: merged, error: e2 } = await sb
    .from("flow_enrollments").select(ENROL_COLS)
    .eq("flow_id", flow.id).eq("contact_id", contactId)
    .contains("context", { checkout_tokens: [token] })
    .order("entered_at", { ascending: false }).limit(1);
  if (e2) throw new Error(`cart merged lookup: ${e2.message}`);
  const m = merged?.[0] as EnrolRow | undefined;
  if (m) return m.status === "active" ? refreshCart(m, context, token, deadlineHours) : false;

  // 3. A live cart sequence for this contact → refresh it in place.
  const live = await findActiveSingle(flow.id, contactId, prefix);
  if (live) return refreshCart(live, context, token, deadlineHours);

  // 4. Brand new sequence.
  const now = Date.now();
  const { data, error } = await sb
    .from("flow_enrollments")
    .upsert(
      {
        flow_id: flow.id,
        contact_id: contactId,
        current_step: 0,
        status: "active",
        dedup_key: dedupKey,
        context: mergeCartContext(null, context, token),
        next_action_at: new Date(now + firstDelayHours * 3_600_000).toISOString(),
        deadline_at: deadlineHours ? new Date(now + deadlineHours * 3_600_000).toISOString() : null,
        entered_at: new Date(now).toISOString(),
      },
      { onConflict: "flow_id,dedup_key", ignoreDuplicates: true },
    )
    .select("id");
  if (!error) return (data?.length ?? 0) > 0;
  if (!isUniqueViolation(error)) throw new Error(`cart enrol insert: ${error.message}`);
  // Lost a race against a concurrent checkout event for the same contact (the
  // one-active-per-contact index fired): fold our cart into the winner.
  const winner = await findActiveSingle(flow.id, contactId, prefix);
  return winner ? refreshCart(winner, context, token, deadlineHours) : false;
}

async function enrolOne(flow: FlowRow, contactId: string, email: string, trigger: string, opts: EnrolOpts): Promise<boolean> {
  const steps = flowSteps(flow);
  if (steps.length === 0) return false;
  const cfg = flow.trigger_config ?? {};
  const deadlineHours = typeof cfg.deadline_hours === "number" && cfg.deadline_hours > 0 ? cfg.deadline_hours : null;
  const firstDelayHours = Number(steps[0]?.delay_hours ?? 0);

  if (isFirstOrderOnly(flow) && (await priorOrderExists(email, opts))) return false;

  const dedupKey = dedupKeyFor(flow, opts, contactId);
  const context: Record<string, unknown> = { ...(opts.context ?? {}), first_name: opts.firstName ?? null };
  if (trigger === "order_placed" && context.order_ref == null) context.order_ref = opts.entityRef;

  if (isSingleActivePerContact(trigger, opts.dedupPrefix)) {
    return enrolSingleActive(flow, contactId, dedupKey, opts.entityRef, opts.dedupPrefix, context, firstDelayHours, deadlineHours);
  }

  const now = Date.now();
  return insertEnrolment({
    flow_id: flow.id,
    contact_id: contactId,
    current_step: 0,
    status: "active",
    dedup_key: dedupKey,
    context,
    next_action_at: new Date(now + firstDelayHours * 3_600_000).toISOString(),
    deadline_at: deadlineHours ? new Date(now + deadlineHours * 3_600_000).toISOString() : null,
    entered_at: new Date(now).toISOString(),
  });
}

/**
 * Enrol a contact into EVERY active flow for `trigger` (or just `opts.flowId`).
 * Returns how many enrolments were created or refreshed. Never throws for a
 * single flow's failure (logged); a flows-lookup failure does throw, and every
 * caller wraps this in try/catch so email can never break WhatsApp.
 */
export async function enrollEmailFlow(trigger: string, opts: EnrolOpts): Promise<number> {
  const email = opts.email?.trim().toLowerCase();
  if (!email) return 0;

  const flows = selectFlowsForEnrol(await activeFlowsFor(trigger), opts.flowId);
  if (flows.length === 0) return 0; // no active flow → enrol nobody

  const contactId = await contactIdForEmail(email);
  if (!contactId) return 0;

  let n = 0;
  for (const flow of flows) {
    try {
      if (await enrolOne(flow, contactId, email, trigger, opts)) n++;
    } catch (e) {
      console.warn(`[email-flows] enrol ${trigger} flow ${flow.id} failed:`, e);
    }
  }
  return n;
}

async function allFlows(): Promise<FlowRow[]> {
  // All statuses: an enrolment in a paused flow is still "active" and would
  // resume later, so it must exit too.
  const { data, error } = await db().from("flows").select("id, trigger_type, steps, trigger_config");
  if (error) throw new Error(`flows lookup: ${error.message}`);
  return (data ?? []) as FlowRow[];
}

async function exitContact(contactId: string, flowIds: string[], patch: Record<string, unknown>): Promise<number> {
  if (flowIds.length === 0) return 0;
  const { data, error } = await db()
    .from("flow_enrollments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("contact_id", contactId)
    .in("flow_id", flowIds)
    .eq("status", "active")
    .select("id");
  if (error) throw new Error(`flow exit: ${error.message}`);
  return data?.length ?? 0;
}

/** Order placed: convert this contact's active cart / welcome / win-back-style
 *  enrolments (every flow where exitsOnOrder). order_placed flows keep running. */
export async function exitFlowsOnOrderForContact(contactId: string): Promise<number> {
  const ids = (await allFlows()).filter(exitsOnOrder).map((f) => f.id);
  return exitContact(contactId, ids, { status: "converted" });
}

export async function exitFlowsOnOrder(email?: string | null): Promise<number> {
  const contactId = await lookupContactId(email);
  if (!contactId) return 0;
  return exitFlowsOnOrderForContact(contactId);
}

/** Checkout started: exit this contact's welcome-style enrolments (every flow
 *  where exitsOnCheckout), because the cart flow takes over. */
export async function exitFlowsOnCheckout(email?: string | null): Promise<number> {
  const contactId = await lookupContactId(email);
  if (!contactId) return 0;
  const ids = (await allFlows()).filter(exitsOnCheckout).map((f) => f.id);
  return exitContact(contactId, ids, { status: "exited", last_error: "checkout started" });
}

// Stop email flows by the CHECKOUT TOKEN the order came from.
//
// The email-keyed stop is not sufficient on its own: most PROMUNCH orders are
// phone-only, so the order carries no email. Shopify stamps the originating
// checkout on the order as checkout_token; the cart enrolment either has it in
// its dedup_key (`abandoned:<token>`) or, if the checkout was merged into a
// running sequence, in context.checkout_tokens. Whoever owns that enrolment is
// the buyer, so every order-exit rule is applied to that contact (cart →
// converted, and welcome / win-back style flows too).
export async function convertAbandonedEmailFlowsByCheckout(checkoutToken?: string | null): Promise<number> {
  const t = String(checkoutToken ?? "").trim();
  if (!t) return 0;
  const sb = db();
  const [byKey, byCtx] = await Promise.all([
    sb.from("flow_enrollments").select("contact_id").eq("dedup_key", `${SINGLE_ACTIVE_PREFIX}:${t}`),
    sb.from("flow_enrollments").select("contact_id")
      .like("dedup_key", `${SINGLE_ACTIVE_PREFIX}:%`)
      .contains("context", { checkout_tokens: [t] }),
  ]);
  if (byKey.error) throw new Error(`checkout convert lookup: ${byKey.error.message}`);
  if (byCtx.error) throw new Error(`checkout convert lookup: ${byCtx.error.message}`);
  const contacts = new Set<string>();
  for (const r of [...(byKey.data ?? []), ...(byCtx.data ?? [])]) {
    if (r.contact_id) contacts.add(r.contact_id as string);
  }
  let n = 0;
  for (const c of contacts) n += await exitFlowsOnOrderForContact(c);
  return n;
}

/** Name parity with the edge twin. */
export async function convertAbandonedEmailFlows(email?: string | null): Promise<number> {
  return exitFlowsOnOrder(email);
}

/**
 * Order cancelled / refunded: cancel active order_placed enrolments for that
 * order (post-purchase, review, replenishment...), matched by dedup_key
 * `postpurchase:<orderRef>` or context.order_ref (first-order flows dedup per
 * contact, so they carry the ref in context).
 */
export async function exitOrderEmailFlows(orderRef: string | null | undefined, reason: "cancelled" | "refunded"): Promise<number> {
  const ref = String(orderRef ?? "").trim();
  if (!ref) return 0;
  const sb = db();
  const { data: flows, error } = await sb.from("flows").select("id").eq("trigger_type", "order_placed");
  if (error) throw new Error(`flows lookup: ${error.message}`);
  const ids = (flows ?? []).map((f) => f.id as string);
  if (ids.length === 0) return 0;
  const patch = { status: "cancelled", last_error: `order ${reason}`, updated_at: new Date().toISOString() };
  const [a, b] = await Promise.all([
    sb.from("flow_enrollments").update(patch).in("flow_id", ids).eq("status", "active")
      .eq("dedup_key", `postpurchase:${ref}`).select("id"),
    sb.from("flow_enrollments").update(patch).in("flow_id", ids).eq("status", "active")
      .eq("context->>order_ref", ref).select("id"),
  ]);
  if (a.error) throw new Error(`order exit: ${a.error.message}`);
  if (b.error) throw new Error(`order exit: ${b.error.message}`);
  return new Set([...(a.data ?? []), ...(b.data ?? [])].map((r) => r.id as string)).size;
}

/** Edge-twin spelling, for symmetry. */
export const enrolEmailFlow = enrollEmailFlow;
