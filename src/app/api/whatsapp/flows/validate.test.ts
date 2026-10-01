import { describe, expect, it } from "vitest";
import { validateCartVoiceDelay, validateVoiceHours, VOICE_LANGUAGES } from "./validate";

describe("voice flow validation", () => {
  it("requires the cart call before the first WhatsApp reminder", () => {
    expect(validateCartVoiceDelay(60, 1)).toBe("The cart call must come before the first WhatsApp reminder.");
    expect(validateCartVoiceDelay(90, 1)).not.toBeNull();
    expect(validateCartVoiceDelay(15, 1)).toBeNull();
  });
  it("rejects start >= end", () => {
    expect(validateVoiceHours(20, 10)).toMatch(/start hour/);
    expect(validateVoiceHours(10, 10)).toMatch(/start hour/);
  });
  it("accepts a sane window", () => {
    expect(validateVoiceHours(10, 20)).toBeNull();
  });
  it("lists Hindi and English as Sarvam languages", () => {
    expect(VOICE_LANGUAGES).toContain("Hindi");
    expect(VOICE_LANGUAGES).toContain("English");
  });
});
