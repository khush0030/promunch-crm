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
  // COD confirmation gate (RTO reduction) — see _shared/cod-gate.ts
  cod_gate_enabled: boolean;
  cod_reminder_delay_hours: number;
  cod_needs_call_hours: number;
  // Confirmation template variants (Flows tab). first = every customer's
  // default; repeat = used instead when the order phone has an earlier
  // shopify_orders row AND the template is approved at Meta. Empty repeat
  // (or unapproved) falls back to first. Both templates MUST take vars
  // 1=name 2=orderRef — same contract as order_confirmation_v2.
  confirmation_template_first: string;
  confirmation_template_repeat: string;
  // Brand voice — the sign-off appended to system-written free-text messages,
  // with a per-surface switch each. Template copy is NOT affected (edit that
  // in the Templates tab; Meta re-approves edits).
  tagline_text: string;
  tagline_bot_replies: boolean;
  tagline_proactive_asks: boolean;
  tagline_cod_gate: boolean;
  tagline_checkout_footer: boolean;
  // Sarvam voice rescue call (fires only after WhatsApp cart recovery fails).
  voice_call_enabled: boolean;
  cart_voice_delay_hours: number;   // hours after cart step 2 before the call is due
  voice_min_cart_value: number;     // INR; 0 = call every cart
  voice_call_start_hour: number;    // IST, inclusive
  voice_call_end_hour: number;      // IST, exclusive
  voice_language: string;           // Sarvam initial_language_name enum
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
  cod_gate_enabled: false,
  cod_reminder_delay_hours: 6,
  cod_needs_call_hours: 24,
  confirmation_template_first: "order_confirmation_v2",
  confirmation_template_repeat: "",
  tagline_text: "Your Munchy Pal 💚",
  tagline_bot_replies: true,
  tagline_proactive_asks: true,
  tagline_cod_gate: true,
  tagline_checkout_footer: true,
  voice_call_enabled: false,
  cart_voice_delay_hours: 6,
  voice_min_cart_value: 0,
  voice_call_start_hour: 10,
  voice_call_end_hour: 20,
  voice_language: "Hindi",
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
