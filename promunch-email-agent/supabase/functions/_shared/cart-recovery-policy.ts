import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Prioritize an unexpired cart even when its next reminder is not due yet.
// A lookup error holds optional marketing; it must not consume cart priority.
export async function hasPriorityCart(sb: SupabaseClient, waId: string, now = new Date().toISOString()): Promise<boolean> {
  const { data, error } = await sb.from("wa_journey_runs").select("id")
    .eq("wa_id", waId).eq("journey_key", "abandoned_checkout").eq("status", "active")
    .is("delivered_at", null).or(`deadline_at.is.null,deadline_at.gt.${now}`).limit(1);
  return !!error || !!data?.length;
}

// One TEMPLATE attempt across every step for this shopper/cart. The existing
// confirmation ledger has a unique primary key, so concurrent sibling steps
// cannot both win. 'sent' here means the attempt budget is consumed, not that
// Meta delivered it. Seal BEFORE sending: timeout/crash never permits a retry.
// No migration or stale-claim takeover. This key is never released on failure.
export async function claimCartTemplateAttempt(sb: SupabaseClient, waId: string, orderRef: string | null): Promise<boolean> {
  if (!waId || !orderRef) return false;
  // Respect attempts made before this guard was deployed, including failures.
  for (let offset = 0; ; offset += 500) {
    const { data: runs, error } = await sb.from("wa_journey_runs")
      .select("id,delivered_at,context").eq("wa_id", waId)
      .eq("journey_key", "abandoned_checkout").eq("order_ref", orderRef)
      .order("id").range(offset, offset + 499);
    if (error) return false;
    if (!runs?.length) break;
    if (runs.some((run) => run.delivered_at || Number(run.context?.tpl_attempts ?? 0) > 0 || run.context?.tpl_stood_down)) return false;
    const { data: messages, error: ledgerError } = await sb.from("wa_messages")
      .select("id").in("journey_run_id", runs.map((run) => run.id)).eq("type", "template").limit(1);
    if (ledgerError || messages?.length) return false;
    if (runs.length < 500) break;
  }
  const { error } = await sb.from("wa_confirmation_claims").insert({
    order_ref: `cart_template_once:${waId}:${orderRef}`, status: "sent",
  });
  return !error;
}
