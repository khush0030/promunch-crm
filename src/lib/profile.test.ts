import { describe, it, expect } from "vitest";
import { avatarPath, avatarUrlOf, validateAvatarUpload, validateAvatarUrl, validateProfileName } from "./profile";

const ID = "6f1c2a9e-1111-4222-8333-944455556666";
const BASE = "https://abc.supabase.co";
const own = (ext = "webp", q = "?v=1") => `${BASE}/storage/v1/object/public/email-assets/avatars/${ID}.${ext}${q}`;

describe("validateProfileName", () => {
  it("trims and collapses whitespace", () => {
    expect(validateProfileName("  Khush   Mutha ")).toEqual({ ok: true, value: "Khush Mutha" });
  });
  it("refuses empty, non-string, too long and control/markup characters", () => {
    expect(validateProfileName("   ").ok).toBe(false);
    expect(validateProfileName(undefined).ok).toBe(false);
    expect(validateProfileName(42).ok).toBe(false);
    expect(validateProfileName("a".repeat(61)).ok).toBe(false);
    expect(validateProfileName("<script>").ok).toBe(false);
    expect(validateProfileName("a\u0000b").ok).toBe(false);
  });
  it("accepts exactly 1 and 60 characters", () => {
    expect(validateProfileName("K")).toEqual({ ok: true, value: "K" });
    expect(validateProfileName("a".repeat(60)).ok).toBe(true);
  });
});

describe("validateAvatarUpload", () => {
  it("allows JPG, PNG, WebP up to 2 MB and returns the extension", () => {
    expect(validateAvatarUpload("image/jpeg", 1000)).toEqual({ ok: true, value: "jpg" });
    expect(validateAvatarUpload("image/png", 2 * 1024 * 1024)).toEqual({ ok: true, value: "png" });
    expect(validateAvatarUpload("image/webp", 10)).toEqual({ ok: true, value: "webp" });
  });
  it("refuses other types, empty and oversize files", () => {
    expect(validateAvatarUpload("image/gif", 10).ok).toBe(false);
    expect(validateAvatarUpload("image/svg+xml", 10).ok).toBe(false);
    expect(validateAvatarUpload("image/png", 0).ok).toBe(false);
    expect(validateAvatarUpload("image/png", 2 * 1024 * 1024 + 1).ok).toBe(false);
    expect(validateAvatarUpload("image/png", "lots").ok).toBe(false);
  });
  it("stores under avatars/<user id>.<ext>", () => {
    expect(avatarPath(ID, "png")).toBe(`avatars/${ID}.png`);
  });
});

describe("validateAvatarUrl", () => {
  it("null or empty removes the photo", () => {
    expect(validateAvatarUrl(null, ID, BASE)).toEqual({ ok: true, value: null });
    expect(validateAvatarUrl("", ID, BASE)).toEqual({ ok: true, value: null });
  });
  it("accepts only the caller's own photo in the public bucket", () => {
    expect(validateAvatarUrl(own(), ID, BASE)).toEqual({ ok: true, value: own() });
    expect(validateAvatarUrl(own("jpg", ""), ID, BASE).ok).toBe(true);
  });
  it("refuses another user's photo, other hosts, other paths and extra params", () => {
    expect(validateAvatarUrl(own(), "someone-else", BASE).ok).toBe(false);
    expect(validateAvatarUrl(own().replace("abc.supabase.co", "evil.example"), ID, BASE).ok).toBe(false);
    expect(validateAvatarUrl(`${BASE}/storage/v1/object/public/email-assets/2026-10/${ID}.png`, ID, BASE).ok).toBe(false);
    expect(validateAvatarUrl(own("gif"), ID, BASE).ok).toBe(false);
    expect(validateAvatarUrl(own("webp", "?v=1&x=2"), ID, BASE).ok).toBe(false);
    expect(validateAvatarUrl(own().replace("https:", "http:"), ID, BASE).ok).toBe(false);
    expect(validateAvatarUrl("javascript:alert(1)", ID, BASE).ok).toBe(false);
    expect(validateAvatarUrl(123, ID, BASE).ok).toBe(false);
  });
});

describe("avatarUrlOf", () => {
  it("reads a usable URL from user_metadata only", () => {
    expect(avatarUrlOf({ avatar_url: own() })).toBe(own());
    expect(avatarUrlOf({ avatar_url: "data:image/png;base64,xx" })).toBeNull();
    expect(avatarUrlOf({})).toBeNull();
    expect(avatarUrlOf(null)).toBeNull();
  });
});
