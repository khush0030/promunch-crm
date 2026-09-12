import { afterEach, describe, expect, it, vi } from "vitest";
import { safeAuthNext } from "./auth-options";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("authentication redirects", () => {
  it("preserves local destinations and their parameters", () => {
    expect(safeAuthNext("/auth/set-password")).toBe("/auth/set-password");
    expect(safeAuthNext("/dashboard/whatsapp?thread=123")).toBe("/dashboard/whatsapp?thread=123");
  });
  it.each([null, "https://evil.example", "//evil.example", "/\\evil.example", "/\nLocation: evil"])("rejects unsafe destination %s", (path) => {
    expect(safeAuthNext(path)).toBe("/dashboard");
  });
});

describe("authentication cookies", () => {
  it("requires HTTPS in production without sharing cookies with sibling hosts", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { authCookieOptions } = await import("./auth-options");
    expect(authCookieOptions).toEqual({ secure: true, sameSite: "lax", path: "/" });
    expect(authCookieOptions).not.toHaveProperty("domain");
  });
  it("allows HTTP for local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { authCookieOptions } = await import("./auth-options");
    expect(authCookieOptions.secure).toBe(false);
  });
});
