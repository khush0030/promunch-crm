// Shapes for the Automations tab. FlowSettings mirrors the wa_flow_settings
// row served by /api/whatsapp/flows (DEFAULTS in that route).

export type FlowSettings = {
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
  cod_gate_enabled: boolean;
  cod_reminder_delay_hours: number;
  cod_needs_call_hours: number;
  confirmation_template_first: string;
  confirmation_template_repeat: string;
  tagline_text: string;
  tagline_bot_replies: boolean;
  tagline_proactive_asks: boolean;
  tagline_cod_gate: boolean;
  tagline_checkout_footer: boolean;
  voice_call_enabled: boolean;
  cart_voice_delay_hours: number;
  cart_voice_delay_minutes: number;
  cod_voice_enabled: boolean;
  cod_voice_delay_hours: number;
  cod_voice_max_attempts: number;
  cod_voice_retry_hours: number;
  voice_min_cart_value: number;
  voice_call_start_hour: number;
  voice_call_end_hour: number;
  voice_language: string;
};

export type SettingKey = keyof FlowSettings;
export type BoolKey = { [K in SettingKey]: FlowSettings[K] extends boolean ? K : never }[SettingKey];

export type TplRow = { name: string; language: string; status: string };
export type Stats = Record<string, Record<string, number>>;

export type TriggerEvent = "order_placed" | "order_fulfilled" | "checkout_abandoned";
export type CustomStep = { delay_hours: number; template: string; language: string; vars: Record<string, string> };
export type CustomFlow = { id: string; name: string; enabled: boolean; trigger_event: TriggerEvent; steps: CustomStep[] };

export type FlowsPayload = { settings?: FlowSettings; templates?: TplRow[]; stats?: Stats; custom?: CustomFlow[] };

export type VoiceStats = { placed: number; connected: number; linkSent: number; recovered: number; assistedRecovered: number };
