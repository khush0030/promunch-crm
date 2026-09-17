// Order events -> Brevo (triggers for Brevo automations: welcome, post-purchase,
// win-back). Pure selection logic plus a server runner.
//
// Reads shopify_orders; never touches the Shopify webhook / WhatsApp order
// path. Each (order, event) is claimed in brevo_event_claims before it is
// posted, so an overlapping tick or a re-run can never send the same event
// (and so the same automation email) twice. Abandoned carts are NOT evented:
// the CRM's own Resend flow owns cart email.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { brevo } from "@/lib/brevo";
import { getBrevoSettings } from "@/lib/brevo-settings";
import { waIdOf, type SyncContact } from "@/lib/brevo-audience";
import { planEvents, type EventOrder, type PlannedEvent } from "@/lib/brevo-events-plan";

const LOOKBACK_DAYS = 3;

export type EventsRunResult = { enabled: boolean; target: "test" | "live"; considered: number; sent: number; failed: number; skipped: Record<string, number>; dryRun: boolean; preview: PlannedEvent[] };

export async function runBrevoEvents(opts: { dryRun?: boolean } = {}): Promise<EventsRunResult> {
  const dryRun = opts.dryRun === true;
  const settings = await getBrevoSettings();
  const base = { target: settings.sync_target, dryRun, sent: 0, failed: 0 };
  if (!settings.migrated) throw new Error("brevo tables missing: apply migration 20260917100000_brevo_integration.sql");
  if (!settings.events_enabled && !dryRun) return { ...base, enabled: false, considered: 0, skipped: {}, preview: [] };

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const [ordersRes, contactsRes, suppressionsRes] = await Promise.all([
    supabaseAdmin
      .from("shopify_orders")
      .select("id, shopify_id, order_number, total_price, currency, customer_email, customer_phone, customer_name, line_items, shopify_created_at, fulfillment_status, financial_status, cancelled_at, source_name, is_creator, customer_order_index")
      .gte("shopify_created_at", since)
      .order("shopify_created_at", { ascending: true })
      .limit(1000),
    supabaseAdmin.from("contacts").select("id, email, first_name, last_name, city, state, phone, status, accepts_marketing, email_consent, anonymized_at").not("email", "is", null).limit(20000),
    supabaseAdmin.from("suppressions").select("email").limit(50000),
  ]);
  for (const r of [ordersRes, contactsRes, suppressionsRes]) if (r.error) throw new Error(r.error.message);
  const orders = (ordersRes.data ?? []) as EventOrder[];
  const orderIds = orders.map((o) => o.id);
  const claimsRes = orderIds.length ? await supabaseAdmin.from("brevo_event_claims").select("order_id, event_name").in("order_id", orderIds) : { data: [], error: null };
  if (claimsRes.error) throw new Error(claimsRes.error.message);

  const contacts = (contactsRes.data ?? []) as SyncContact[];
  const contactsByEmail = new Map(contacts.map((c) => [c.email!.trim().toLowerCase(), c]));
  const emailByWaId = new Map<string, string>();
  for (const c of contacts) {
    const w = waIdOf(c.phone);
    if (w && !emailByWaId.has(w)) emailByWaId.set(w, c.email!.trim().toLowerCase());
  }

  const { planned, skipped } = planEvents({
    orders,
    claimed: new Set((claimsRes.data ?? []).map((c) => `${c.order_id}:${c.event_name}`)),
    contactsByEmail,
    emailByWaId,
    suppressed: new Set((suppressionsRes.data ?? []).map((s) => String(s.email).toLowerCase())),
    target: settings.sync_target,
    testEmails: new Set(settings.test_emails),
    now: new Date(),
  });

  if (dryRun) return { ...base, enabled: settings.events_enabled, considered: orders.length, skipped, preview: planned.slice(0, 10) };

  let sent = 0;
  let failed = 0;
  for (const p of planned) {
    // Claim first. Losing the insert means another run owns this event.
    const { error: claimErr } = await supabaseAdmin.from("brevo_event_claims").insert({ order_id: p.orderId, event_name: p.event, email: p.email });
    if (claimErr) {
      if (claimErr.code !== "23505") failed += 1;
      continue;
    }
    try {
      await brevo("POST", "/events", p.payload);
      await supabaseAdmin.from("brevo_event_claims").update({ status: "sent" }).eq("order_id", p.orderId).eq("event_name", p.event);
      sent += 1;
    } catch (e) {
      // Not retried automatically: a retry after an ambiguous failure could
      // start the same automation twice. Visible in the Automations tab.
      await supabaseAdmin
        .from("brevo_event_claims")
        .update({ status: "failed", error: e instanceof Error ? e.message : String(e) })
        .eq("order_id", p.orderId)
        .eq("event_name", p.event);
      failed += 1;
    }
  }
  return { ...base, enabled: true, considered: orders.length, sent, failed, skipped, preview: [] };
}
