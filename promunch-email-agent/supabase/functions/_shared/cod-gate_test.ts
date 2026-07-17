import { assertEquals } from "jsr:@std/assert";
import {
  buildVerifyComponents,
  buildVerifyVars,
  codTotalLabel,
  decideCancelGuards,
  isCodOrder,
  parseGatePayload,
} from "./cod-gate.ts";

Deno.test("isCodOrder: true when gateway names contain COD", () => {
  assertEquals(isCodOrder({ payment_gateway_names: ["Cash on Delivery (COD)"] }), true);
  assertEquals(isCodOrder({ payment_gateway_names: ["cod"] }), true);
});

Deno.test("isCodOrder: false for prepaid gateways", () => {
  assertEquals(isCodOrder({ payment_gateway_names: ["Razorpay Secure"], financial_status: "pending" }), false);
});

Deno.test("isCodOrder: falls back to financial_status when gateways missing", () => {
  assertEquals(isCodOrder({ financial_status: "pending" }), true);
  assertEquals(isCodOrder({ financial_status: "paid" }), false);
  assertEquals(isCodOrder({}), false);
});

Deno.test("parseGatePayload: all four actions", () => {
  assertEquals(parseGatePayload("CONFIRM_123"), { action: "confirm", shopifyId: "123" });
  assertEquals(parseGatePayload("CANCEL_123"), { action: "cancel_ask", shopifyId: "123" });
  assertEquals(parseGatePayload("CANCELCONF_123"), { action: "cancel_confirm", shopifyId: "123" });
  assertEquals(parseGatePayload("KEEP_123"), { action: "keep", shopifyId: "123" });
});

Deno.test("parseGatePayload: rejects noise", () => {
  assertEquals(parseGatePayload("hello"), null);
  assertEquals(parseGatePayload("CONFIRM_abc"), null);
  assertEquals(parseGatePayload(null), null);
  assertEquals(parseGatePayload("CONFIRM_"), null);
});

Deno.test("buildVerifyComponents: body params + two payload buttons", () => {
  const comps = buildVerifyComponents(buildVerifyVars("Priya", "#2091", "₹398"), 555) as any[];
  assertEquals(comps[0].type, "body");
  assertEquals(comps[0].parameters.map((p: any) => p.text), ["Priya", "#2091", "₹398"]);
  assertEquals(comps[1], {
    type: "button", sub_type: "quick_reply", index: "0",
    parameters: [{ type: "payload", payload: "CONFIRM_555" }],
  });
  assertEquals(comps[2], {
    type: "button", sub_type: "quick_reply", index: "1",
    parameters: [{ type: "payload", payload: "CANCEL_555" }],
  });
});

Deno.test("codTotalLabel: rounds and prefixes rupee for INR", () => {
  assertEquals(codTotalLabel(398.0, "INR"), "₹398");
  assertEquals(codTotalLabel(499.5, "USD"), "USD 500");
});

Deno.test("decideCancelGuards: unpaid + unfulfilled → auto-cancel allowed", () => {
  assertEquals(decideCancelGuards({ financial_status: "pending", raw: {} }), { allow: true });
});

Deno.test("decideCancelGuards: paid order → manual path", () => {
  assertEquals(
    decideCancelGuards({ financial_status: "paid", raw: {} }),
    { allow: false, why: "paid" },
  );
});

Deno.test("decideCancelGuards: fulfilled order → manual path", () => {
  assertEquals(
    decideCancelGuards({ financial_status: "pending", raw: { fulfillment_status: "fulfilled" } }),
    { allow: false, why: "fulfilled" },
  );
});
