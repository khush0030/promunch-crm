import { describe, it, expect } from "vitest";
import { tierOfRole, isAdminUser } from "./rbac";

describe("tierOfRole", () => {
  it("maps owner/admin (and missing) to admin", () => {
    expect(tierOfRole("owner")).toBe("admin");
    expect(tierOfRole("admin")).toBe("admin");
    expect(tierOfRole(undefined)).toBe("admin");
    expect(tierOfRole(null)).toBe("admin");
    expect(tierOfRole("something-unknown")).toBe("admin");
  });
  it("maps agent/member to member", () => {
    expect(tierOfRole("agent")).toBe("member");
    expect(tierOfRole("member")).toBe("member");
  });
});

describe("isAdminUser", () => {
  it("treats a user with no role as admin (back-compat)", () => {
    expect(isAdminUser({ user_metadata: {} })).toBe(true);
    expect(isAdminUser({})).toBe(true);
  });
  it("treats agent as non-admin", () => {
    expect(isAdminUser({ user_metadata: { role: "agent" } })).toBe(false);
  });
  it("treats owner/admin as admin", () => {
    expect(isAdminUser({ user_metadata: { role: "owner" } })).toBe(true);
    expect(isAdminUser({ user_metadata: { role: "admin" } })).toBe(true);
  });
  it("returns false for null/undefined", () => {
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
  });
});
