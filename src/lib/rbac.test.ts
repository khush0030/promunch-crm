import { describe, it, expect } from "vitest";
import { tierOfRole, isAdminUser, OWNER_EMAIL } from "./rbac";

describe("tierOfRole", () => {
  it("maps owner/admin to admin", () => {
    expect(tierOfRole("owner")).toBe("admin");
    expect(tierOfRole("admin")).toBe("admin");
  });
  it("fails closed: missing/unknown roles are member", () => {
    expect(tierOfRole(undefined)).toBe("member");
    expect(tierOfRole(null)).toBe("member");
    expect(tierOfRole("something-unknown")).toBe("member");
  });
  it("maps agent/member to member", () => {
    expect(tierOfRole("agent")).toBe("member");
    expect(tierOfRole("member")).toBe("member");
  });
});

describe("isAdminUser", () => {
  it("reads roles from app_metadata only", () => {
    expect(isAdminUser({ app_metadata: { role: "admin" } })).toBe(true);
    expect(isAdminUser({ app_metadata: { role: "owner" } })).toBe(true);
    expect(isAdminUser({ app_metadata: { role: "agent" } })).toBe(false);
  });
  it("ignores user_metadata roles (self-escalation guard)", () => {
    expect(isAdminUser({ user_metadata: { role: "admin" } })).toBe(false);
    expect(isAdminUser({ user_metadata: { role: "owner" } })).toBe(false);
  });
  it("fails closed on a missing role", () => {
    expect(isAdminUser({ app_metadata: {} })).toBe(false);
    expect(isAdminUser({})).toBe(false);
  });
  it("always grants the owner email admin (lockout guard)", () => {
    expect(isAdminUser({ email: OWNER_EMAIL })).toBe(true);
    expect(isAdminUser({ email: OWNER_EMAIL.toUpperCase() })).toBe(true);
  });
  it("returns false for null/undefined", () => {
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
  });
});
