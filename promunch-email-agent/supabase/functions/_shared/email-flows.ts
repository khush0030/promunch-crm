// Email-flow enrolment from Shopify events. DB-only: this never sends an email
// (the app-side email-flow-tick cron does). It only enrols a contact into an
// ACTIVE email flow, keyed on the customer's EMAIL — independent of the
// WhatsApp cart flow, which keys on phone (a checkout may have one and not the
// other).
//
// No-duplicate invariant (CLAUDE.md §0): enrolment is idempotent via the
// (flow_id, dedup_key) unique index on flow_enrollments — a repeated
// checkouts/update or orders/create for the same entity is a no-op. If there is
// no ACTIVE flow for the trigger, we enrol nobody (no pile-up while a flow is
// still a draft).

import { db } from "./supabase.ts";

type FlowRow = { id: string; steps: unknown; trigger_config: Record<string, unknown> | null };

async function activeFlowFor(trigger: string): Promise<FlowRow | null> {
  const { data } = await db()
    .from("flows")
    .select("id, steps, trigger_config")
    .eq("trigger_type", trigger)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);
  return (data?.[0] as FlowRow | undefined) ?? null;
}

async function contactIdForEmail(email: string, firstName?: string | null): Promise<string | null> {
  const lc = email.toLowerCase();
  const sb = db();
  // Upsert on the unique email so a checkout-only shopper still gets a contact
  // row. Keep it minimal; the Shopify order webhook enriches it later.
  const { data } = await sb
    .from("contacts")
    .upsert({ email: lc, first_name: firstName ?? null, status: "active", source: "shopify" }, { onConflict: "email", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (data?.id) return data.id as string;
  const { data: got } = await sb.from("contacts").select("id").eq("email", lc).maybeSingle();
  return (got?.id as string | undefined) ?? null;
}

export async function enrolEmailFlow(
  trigger: string,
  opts: {
    email?: string | null;
    entityRef: string;
    dedupPrefix: string;
    firstName?: string | null;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  const email = opts.email?.trim();
  if (!email) return;

  const flow = await activeFlowFor(trigger);
  if (!flow) return; // no active flow → enrol nobody
  const steps = Array.isArray(flow.steps) ? (flow.steps as Array<{ delay_hours?: number }>) : [];
  if (steps.length === 0) return;

  const contactId = await contactIdForEmail(email, opts.firstName);
  if (!contactId) return;

  const cfg = flow.trigger_config ?? {};
  const deadlineHours = typeof cfg.deadline_hours === "number" ? cfg.deadline_hours : null;
  const firstDelayHours = Number(steps[0]?.delay_hours ?? 0);

  await db()
    .from("flow_enrollments")
    .upsert(
      {
        flow_id: flow.id,
        contact_id: contactId,
        current_step: 0,
        status: "active",
        dedup_key: `${opts.dedupPrefix}:${opts.entityRef}`,
        context: { ...(opts.context ?? {}), first_name: opts.firstName ?? null },
        next_action_at: new Date(Date.now() + firstDelayHours * 3_600_000).toISOString(),
        deadline_at: deadlineHours ? new Date(Date.now() + deadlineHours * 3_600_000).toISOString() : null,
        entered_at: new Date().toISOString(),
      },
      { onConflict: "flow_id,dedup_key", ignoreDuplicates: true },
    );
}

// Stop an abandoned-cart email flow by the CHECKOUT TOKEN the order came from.
//
// This exists because the email-keyed stop below is not sufficient: it returns
// early when the order carries no email, and most PROMUNCH orders are
// phone-only. Without this, a customer who abandoned with an email and then
// completed a phone-only order would keep receiving "your cart is still saved"
// for the next 22 hours, after having already bought. That is the exact
// post-purchase spam the no-duplicate invariant exists to prevent.
//
// The enrolment's dedup_key is `abandoned:<checkout token>` (see enrolEmailFlow
// callers in shopify-wa), and Shopify stamps the originating checkout on the
// order as checkout_token, so this is an exact match and needs no identity
// resolution at all.
export async function convertAbandonedEmailFlowsByCheckout(
  checkoutToken?: string | null,
): Promise<void> {
  const t = String(checkoutToken ?? "").trim();
  if (!t) return;
  await db()
    .from("flow_enrollments")
    .update({ status: "converted", updated_at: new Date().toISOString() })
    .eq("dedup_key", `abandoned:${t}`)
    .eq("status", "active");
}

// When a customer places an order, stop their ACTIVE abandoned-cart email flows
// (they converted). Post-purchase / welcome flows are left running.
export async function convertAbandonedEmailFlows(email?: string | null): Promise<void> {
  const e = email?.trim().toLowerCase();
  if (!e) return;
  const sb = db();
  const { data: c } = await sb.from("contacts").select("id").eq("email", e).maybeSingle();
  if (!c?.id) return;

  const { data: cartFlows } = await sb.from("flows").select("id").eq("trigger_type", "checkout_abandoned");
  const ids = (cartFlows ?? []).map((f) => f.id as string);
  if (ids.length === 0) return;

  await sb
    .from("flow_enrollments")
    .update({ status: "converted", updated_at: new Date().toISOString() })
    .eq("contact_id", c.id)
    .in("flow_id", ids)
    .eq("status", "active");
}
