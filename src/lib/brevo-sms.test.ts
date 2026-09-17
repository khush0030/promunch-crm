import { describe, expect, it } from "vitest";
import { smsParts, validateSmsDraft } from "./brevo-sms";

describe("smsParts", () => {
  it("counts GSM and unicode parts", () => {
    expect(smsParts("", false)).toBe(0);
    expect(smsParts("a".repeat(160), false)).toBe(1);
    expect(smsParts("a".repeat(161), false)).toBe(2);
    expect(smsParts("a".repeat(70), true)).toBe(1);
    expect(smsParts("a".repeat(71), true)).toBe(2);
  });
});

describe("validateSmsDraft", () => {
  it("accepts a draft and defaults the STOP opt-out", () => {
    const r = validateSmsDraft({ name: "Diwali", sender: "PRMNCH", content: "PROMUNCH Diwali boxes are live", listIds: [9] });
    expect(r.ok && r.draft).toMatchObject({ sender: "PRMNCH", unsubscribeInstruction: "Reply STOP to opt out", recipients: { listIds: [9] } });
  });
  it("rejects bad senders, missing STOP and brand-rule breaks", () => {
    const r = validateSmsDraft({ name: "x", sender: "PROMUNCH-SNACKS", content: "Promunch — sale", unsubscribeInstruction: "reply no" });
    expect(r.ok === false && r.errors.length).toBe(4);
  });
  it("allows partial updates", () => {
    expect(validateSmsDraft({ content: "PROMUNCH is back" }, true)).toEqual({ ok: true, draft: { content: "PROMUNCH is back" } });
  });
});
