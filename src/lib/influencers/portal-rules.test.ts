import { describe, expect, it } from "vitest";
import {
  MAX_DRAFT_BYTES,
  canRequestChange,
  decidePortalTransition,
  draftStoragePath,
  isBefore,
  isOwnStoragePath,
  isValidPortalCode,
  normaliseHttpUrl,
  normaliseInstagramPostUrl,
  safeFileName,
  validateUpload,
} from "./portal-rules";

const DEAL = "3f2b8c1e-1d2a-4b3c-9d8e-0a1b2c3d4e5f";

describe("isValidPortalCode", () => {
  it("accepts 12 to 64 url-safe chars (DEAL_CODE_RE)", () => {
    expect(isValidPortalCode("abcDEF123_-x")).toBe(true);
    expect(isValidPortalCode("a".repeat(64))).toBe(true);
  });
  it("rejects short, long, odd chars and non-strings", () => {
    expect(isValidPortalCode("short")).toBe(false);
    expect(isValidPortalCode("a".repeat(65))).toBe(false);
    expect(isValidPortalCode("abc def 1234")).toBe(false);
    expect(isValidPortalCode("abcdefghijk/l")).toBe(false);
    expect(isValidPortalCode(undefined)).toBe(false);
  });
});

describe("decidePortalTransition", () => {
  it("applies at the right stage", () => {
    expect(decidePortalTransition("ack", "brief_sent")).toEqual({ kind: "apply", to: "brief_acknowledged" });
    expect(decidePortalTransition("received", "dispatched")).toEqual({ kind: "apply", to: "delivered" });
    expect(decidePortalTransition("received", "brief_acknowledged")).toEqual({ kind: "apply", to: "delivered" });
    expect(decidePortalTransition("draft", "delivered")).toEqual({ kind: "apply", to: "draft_submitted" });
    expect(decidePortalTransition("draft", "changes_requested")).toEqual({ kind: "apply", to: "draft_submitted" });
    expect(decidePortalTransition("post", "draft_approved")).toEqual({ kind: "apply", to: "posted" });
  });
  it("is an idempotent no-op once past the step", () => {
    expect(decidePortalTransition("ack", "dispatched").kind).toBe("noop");
    expect(decidePortalTransition("received", "draft_submitted").kind).toBe("noop");
    expect(decidePortalTransition("received", "changes_requested").kind).toBe("noop");
    expect(decidePortalTransition("draft", "draft_submitted").kind).toBe("noop");
    expect(decidePortalTransition("draft", "draft_approved").kind).toBe("noop");
    expect(decidePortalTransition("post", "posted").kind).toBe("noop");
    expect(decidePortalTransition("post", "completed").kind).toBe("noop");
  });
  it("rejects too early and closed deals", () => {
    expect(decidePortalTransition("ack", "brief_draft").kind).toBe("reject");
    expect(decidePortalTransition("received", "brief_sent").kind).toBe("reject");
    expect(decidePortalTransition("draft", "dispatched").kind).toBe("reject");
    expect(decidePortalTransition("post", "draft_submitted").kind).toBe("reject");
    expect(decidePortalTransition("post", "changes_requested").kind).toBe("reject");
    expect(decidePortalTransition("ack", "cancelled").kind).toBe("reject");
    expect(decidePortalTransition("draft", "ghosted").kind).toBe("reject");
  });
});

describe("stage helpers", () => {
  it("isBefore ignores closed stages", () => {
    expect(isBefore("brief_draft", "brief_sent")).toBe(true);
    expect(isBefore("brief_sent", "brief_sent")).toBe(false);
    expect(isBefore("cancelled", "brief_sent")).toBe(false);
  });
  it("canRequestChange only after the brief goes out", () => {
    expect(canRequestChange("brief_draft")).toBe(false);
    expect(canRequestChange("brief_sent")).toBe(true);
    expect(canRequestChange("draft_approved")).toBe(true);
    expect(canRequestChange("ghosted")).toBe(false);
  });
});

describe("uploads", () => {
  it("validates video type and size", () => {
    expect(validateUpload({ filename: "a.mp4", size: 10, contentType: "video/mp4" }).ok).toBe(true);
    expect(validateUpload({ filename: "a.mov", size: MAX_DRAFT_BYTES, contentType: "video/quicktime" }).ok).toBe(true);
    expect(validateUpload({ filename: "a.mp4", size: MAX_DRAFT_BYTES + 1, contentType: "video/mp4" }).ok).toBe(false);
    expect(validateUpload({ filename: "a.jpg", size: 10, contentType: "image/jpeg" }).ok).toBe(false);
    expect(validateUpload({ filename: "", size: 10, contentType: "video/mp4" }).ok).toBe(false);
    expect(validateUpload({ filename: "a.mp4", size: 0, contentType: "video/mp4" }).ok).toBe(false);
  });
  it("makes safe file names", () => {
    expect(safeFileName("My Reel (final) v2.MP4")).toBe("My-Reel-final-v2.mp4");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("🎬.mov")).toBe("draft.mov");
  });
  it("issues and recognises own storage paths only", () => {
    const p = draftStoragePath(DEAL, "clip.mp4", 1759800000000);
    expect(p).toBe(`${DEAL}/1759800000000-clip.mp4`);
    expect(isOwnStoragePath(DEAL, p)).toBe(true);
    expect(isOwnStoragePath("00000000-0000-0000-0000-000000000000", p)).toBe(false);
    expect(isOwnStoragePath(DEAL, `${DEAL}/../other/1759800000000-x.mp4`)).toBe(false);
    expect(isOwnStoragePath(DEAL, `${DEAL}/clip.mp4`)).toBe(false);
    expect(isOwnStoragePath(DEAL, 42)).toBe(false);
  });
});

describe("links", () => {
  it("normalises http links", () => {
    expect(normaliseHttpUrl("drive.google.com/file/d/abc")).toBe("https://drive.google.com/file/d/abc");
    expect(normaliseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseHttpUrl("not a url")).toBeNull();
    expect(normaliseHttpUrl("")).toBeNull();
  });
  it("accepts only instagram post/reel links", () => {
    expect(normaliseInstagramPostUrl("https://www.instagram.com/reel/Cx123abc/?igsh=xyz")).toBe(
      "https://www.instagram.com/reel/Cx123abc/",
    );
    expect(normaliseInstagramPostUrl("instagram.com/p/AbC_12-3")).toBe("https://instagram.com/p/AbC_12-3");
    expect(normaliseInstagramPostUrl("https://www.instagram.com/promunch.snacks/")).toBeNull();
    expect(normaliseInstagramPostUrl("https://evil-instagram.com/reel/abc")).toBeNull();
    expect(normaliseInstagramPostUrl("https://youtube.com/shorts/abc")).toBeNull();
  });
});
