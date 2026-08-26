import { describe, expect, it } from "vitest";
import { validateVoiceHours, VOICE_LANGUAGES } from "./validate";

describe("voice flow validation", () => {
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
