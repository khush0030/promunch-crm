// Who may change which WhatsApp automation setting (wa_flow_settings).
//
// Order messages go to every customer who orders (confirmation, COD confirm
// gate, shipping update, the sign-off tagline, the voice rescue call) and the
// cart retry safety limits protect our Meta marketing budget, so only the
// Owner or an Admin may change them. Marketing automations (cart reminder
// timing and coupon, review ask, restock reminder) are open to any teammate
// with the WhatsApp marketing area. Pure, so the UI and tests share it.

export const ORDER_MESSAGE_KEYS: ReadonlySet<string> = new Set([
  "order_confirmation_enabled",
  "confirmation_template_first",
  "confirmation_template_repeat",
  "shipping_update_enabled",
  "cod_gate_enabled",
  "cod_reminder_delay_hours",
  "cod_needs_call_hours",
  "tagline_text",
  "tagline_bot_replies",
  "tagline_proactive_asks",
  "tagline_cod_gate",
  "tagline_checkout_footer",
  "voice_call_enabled",
  "cart_voice_delay_hours",
  "voice_min_cart_value",
  "voice_call_start_hour",
  "voice_call_end_hour",
  "voice_language",
  // cart recovery retry safety limits (Meta marketing cap protection)
  "cart_deadline_hours",
  "cart_backoff_hours",
]);

export const ORDER_MESSAGES_ADMIN_ONLY =
  "Only the owner or an admin can change order messages, because they affect every order. Ask an admin to make this change.";

/** True when a teammate who is not an admin may change this setting key. */
export function memberMayEdit(key: string): boolean {
  return !ORDER_MESSAGE_KEYS.has(key);
}
