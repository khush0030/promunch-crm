// Dashboard-managed journey settings (wa_flow_settings singleton, id = 1).
// FLOW_DEFAULTS reproduces the pre-settings hardcoded behavior exactly, and is
// the fallback whenever the table/row is missing or a column is null — so the
// flows keep working even before migration 20260705190000 is applied.
// Keep in sync with DEFAULTS in src/app/api/whatsapp/flows/route.ts.

import { db } from "./supabase.ts";

export interface FlowSettings {
  order_confirmation_enabled: boolean;
  shipping_update_enabled: boolean;
  abandoned_cart_enabled: boolean;
  cart_step1_delay_hours: number;
  cart_step2_delay_hours: number;
  cart_deadline_hours: number;
  cart_backoff_hours: number;
  cart_coupon_code: string;
  review_request_enabled: boolean;
  review_delay_days: number;
  replenishment_enabled: boolean;
  replenishment_delay_days: number;
}

export const FLOW_DEFAULTS: FlowSettings = {
  order_confirmation_enabled: true,
  shipping_update_enabled: true,
  abandoned_cart_enabled: true,
  cart_step1_delay_hours: 1,
  cart_step2_delay_hours: 6,
  cart_deadline_hours: 72,
  cart_backoff_hours: 6,
  cart_coupon_code: "PROMUNCH10",
  review_request_enabled: true,
  review_delay_days: 7,
  replenishment_enabled: true,
  replenishment_delay_days: 30,
};

export async function getFlowSettings(): Promise<FlowSettings> {
  try {
    const { data } = await db()
      .from("wa_flow_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (!data) return FLOW_DEFAULTS;
    const out: Record<string, unknown> = { ...FLOW_DEFAULTS };
    for (const k of Object.keys(FLOW_DEFAULTS) as Array<keyof FlowSettings>) {
      const v = (data as Record<string, unknown>)[k];
      if (v === null || v === undefined) continue;
      // numeric columns arrive as strings from PostgREST
      out[k] = typeof FLOW_DEFAULTS[k] === "number" ? Number(v) : v;
    }
    return out as unknown as FlowSettings;
  } catch {
    return FLOW_DEFAULTS; // never let a settings read break a journey send
  }
}
