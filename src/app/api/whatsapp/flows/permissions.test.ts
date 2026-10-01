import { describe, expect, it } from "vitest";
import { memberMayEdit, ORDER_MESSAGE_KEYS } from "./permissions";

describe("flow settings permissions", () => {
  it("keeps order messages owner/admin only", () => {
    for (const k of ["order_confirmation_enabled", "cod_gate_enabled", "shipping_update_enabled", "voice_call_enabled", "tagline_text", "confirmation_template_first", "cart_deadline_hours", "cart_backoff_hours"]) {
      expect(ORDER_MESSAGE_KEYS.has(k)).toBe(true);
      expect(memberMayEdit(k)).toBe(false);
    }
  });
  it("treats the new voice settings as order-area settings", () => {
    for (const k of ["cart_voice_delay_minutes", "cod_voice_enabled", "cod_voice_delay_hours", "cod_voice_max_attempts", "cod_voice_retry_hours"]) {
      expect(ORDER_MESSAGE_KEYS.has(k)).toBe(true);
      expect(memberMayEdit(k)).toBe(false);
    }
  });
  it("lets marketing teammates edit marketing automations", () => {
    for (const k of ["abandoned_cart_enabled", "cart_step1_delay_hours", "cart_step2_delay_hours", "cart_coupon_code", "review_request_enabled", "review_delay_days", "replenishment_enabled", "replenishment_delay_days"]) {
      expect(memberMayEdit(k)).toBe(true);
    }
  });
});
