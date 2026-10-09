// Orders → Voice calls KPI strip: one period's totals from voice_calls.
// Pure; GET /api/whatsapp/voice-calls/summary does the reads.

export type VoicePeriod = "24h" | "7d" | "30d";
export const VOICE_PERIOD_HOURS: Record<VoicePeriod, number> = { "24h": 24, "7d": 168, "30d": 720 };

export function parseVoicePeriod(raw: string | null | undefined): VoicePeriod {
  return raw === "24h" || raw === "30d" ? raw : "7d";
}

export type SummaryCall = { purpose: string | null; status: string; outcome: string | null; wa_id: string; created_at: string };
export type SummaryOrder = { customer_phone: string | null; shopify_created_at: string; total_price: number | string | null };

export type VoiceSummary = {
  calls: number; // calls placed (the agent tried to dial)
  reached: number; // picked up
  confirmed: number; // COD orders confirmed on the call
  cancelled: number; // COD orders the customer asked to cancel
  noAnswer: number; // no answer, busy or did not connect
  notStarted: number; // never dialled (start_failed)
  waiting: number; // result not in yet
  cartOrdered: number; // cart calls followed by an order within 72h
  cartOrderedValue: number;
  successRate: number; // (confirmed + cartOrdered) / calls that started, 0-100
};

// Same linkage rule as the call list: an order on the same number within 72
// hours after a cart call is "likely ordered after the call", never proof.
export const ORDER_AFTER_CALL_MS = 72 * 3_600_000;

export function summarizeVoice(calls: SummaryCall[], orders: SummaryOrder[]): VoiceSummary {
  const s: VoiceSummary = {
    calls: calls.length, reached: 0, confirmed: 0, cancelled: 0, noAnswer: 0, notStarted: 0, waiting: 0,
    cartOrdered: 0, cartOrderedValue: 0, successRate: 0,
  };
  const ordersByPhone = new Map<string, { t: number; total: number }[]>();
  for (const o of orders) {
    if (!o.customer_phone) continue;
    const arr = ordersByPhone.get(o.customer_phone) ?? [];
    arr.push({ t: new Date(o.shopify_created_at).getTime(), total: Number(o.total_price) || 0 });
    ordersByPhone.set(o.customer_phone, arr);
  }
  for (const arr of ordersByPhone.values()) arr.sort((a, b) => a.t - b.t);

  for (const c of calls) {
    if (c.status === "connected") s.reached++;
    else if (c.status === "no_answer" || c.status === "busy" || c.status === "failed") s.noAnswer++;
    else if (c.status === "start_failed") s.notStarted++;
    else if (c.status === "dialing") s.waiting++;
    if (c.purpose === "cod_confirm") {
      if (c.outcome === "confirmed") s.confirmed++;
      if (c.outcome === "cancel_requested") s.cancelled++;
    } else if (c.purpose === "cart") {
      const t = new Date(c.created_at).getTime();
      const hit = (ordersByPhone.get(c.wa_id) ?? []).find((o) => o.t > t && o.t - t <= ORDER_AFTER_CALL_MS);
      if (hit) { s.cartOrdered++; s.cartOrderedValue += hit.total; }
    }
  }
  const started = s.calls - s.notStarted;
  s.successRate = started > 0 ? Math.round(((s.confirmed + s.cartOrdered) / started) * 100) : 0;
  return s;
}
