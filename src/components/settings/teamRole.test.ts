import { describe, expect, it } from "vitest";
import { OWNER_EMAIL } from "@/lib/rbac";
import { displayRole, isOwnerMember } from "./teamRole";

describe("team list owner rule", () => {
  it("treats the owner email as Owner even when its stored role is admin", () => {
    expect(isOwnerMember({ email: OWNER_EMAIL, role: "admin" })).toBe(true);
    expect(isOwnerMember({ email: OWNER_EMAIL.toUpperCase(), role: "admin" })).toBe(true);
    expect(displayRole({ email: OWNER_EMAIL, role: "admin" })).toBe("owner");
  });

  it("treats an explicit owner role as Owner", () => {
    expect(displayRole({ email: "x@promunch.in", role: "owner" })).toBe("owner");
  });

  it("leaves everyone else on their stored role", () => {
    expect(isOwnerMember({ email: "x@promunch.in", role: "admin" })).toBe(false);
    expect(displayRole({ email: "x@promunch.in", role: "agent" })).toBe("agent");
    expect(displayRole({ email: null, role: "admin" })).toBe("admin");
  });
});
