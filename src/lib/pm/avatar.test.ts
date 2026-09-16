import { describe, expect, it } from "vitest";
import { AVATAR_COLOR_TOKENS, avatarColorToken, avatarTextColor, initials } from "./avatar";

describe("avatarColorToken", () => {
  it("is stable for the same name", () => {
    expect(avatarColorToken("Priya Sharma")).toBe(avatarColorToken("Priya Sharma"));
  });

  it("only returns tokens from the approved list", () => {
    for (const name of ["Priya Sharma", "Rahul Mehta", "@fit.with.riya", "Nashik Traders", ""]) {
      expect(AVATAR_COLOR_TOKENS).toContain(avatarColorToken(name));
    }
  });

  it("spreads different names across more than one token", () => {
    const tokens = new Set(
      ["Priya Sharma", "Rahul Mehta", "Anita Kulkarni", "Kiran Rao", "Nashik Traders", "Meera D."].map(avatarColorToken),
    );
    expect(tokens.size).toBeGreaterThan(1);
  });
});

describe("avatarTextColor", () => {
  it("is dark ink on the sun token and white otherwise", () => {
    expect(avatarTextColor("var(--pm-sun)")).toBe("#1D1517");
    expect(avatarTextColor("var(--pm-cyan)")).toBe("#fff");
    expect(avatarTextColor("var(--pm-muted)")).toBe("#fff");
  });
});

describe("initials", () => {
  it("takes first+last initial for multi-word names", () => {
    expect(initials("Priya Sharma")).toBe("PS");
  });

  it("takes first two letters for a single word", () => {
    expect(initials("Edamame")).toBe("ED");
  });

  it("falls back to ? for empty input", () => {
    expect(initials("   ")).toBe("?");
  });
});
