import { describe, expect, it } from "vitest";
import { canSend } from "./composer";

describe("canSend", () => {
  it("is false while busy, even with text", () => {
    expect(canSend({ busy: true, value: "Hi there" })).toBe(false);
  });

  it("is false for empty text", () => {
    expect(canSend({ busy: false, value: "" })).toBe(false);
  });

  it("is false for whitespace-only text", () => {
    expect(canSend({ busy: false, value: "   \n\t" })).toBe(false);
  });

  it("is false when disabledReason is set, even with text and not busy", () => {
    expect(canSend({ busy: false, value: "Hi there", disabledReason: "24-hour window closed, send a template" })).toBe(false);
  });

  it("is true with non-empty text, not busy, no disabledReason", () => {
    expect(canSend({ busy: false, value: "Hi there" })).toBe(true);
  });

  it("treats an empty-string disabledReason as no reason", () => {
    expect(canSend({ busy: false, value: "Hi there", disabledReason: "" })).toBe(true);
  });

  it("is true with an attachment and no text, but not while disabled", () => {
    expect(canSend({ busy: false, value: "", hasAttachment: true })).toBe(true);
    expect(canSend({ busy: false, value: "", hasAttachment: true, disabledReason: "closed" })).toBe(false);
  });
});
