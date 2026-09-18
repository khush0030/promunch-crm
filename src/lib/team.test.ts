import { describe, it, expect } from "vitest";
import { resolveTeamDisplayName } from "./team";

describe("resolveTeamDisplayName", () => {
  it("prefers user_metadata.full_name", () => {
    expect(resolveTeamDisplayName({ email: "khush@trypromunch.in", user_metadata: { full_name: "Khush Mutha" } })).toBe(
      "Khush Mutha",
    );
  });
  it("falls back to user_metadata.name", () => {
    expect(resolveTeamDisplayName({ email: "khush@trypromunch.in", user_metadata: { name: "Khush" } })).toBe("Khush");
  });
  it("falls back to the email local part, uncapitalised, when there is no name", () => {
    expect(resolveTeamDisplayName({ email: "narendra@trypromunch.in", user_metadata: {} })).toBe("narendra");
  });
  it("falls back to 'User' when there is no email either", () => {
    expect(resolveTeamDisplayName({ email: null, user_metadata: {} })).toBe("User");
  });
});
