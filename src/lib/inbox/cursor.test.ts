import { describe, expect, it } from "vitest";
import { parseCursor, isAfterCursor } from "./cursor";

describe("parseCursor", () => {
  it("splits at the first pipe", () => {
    expect(parseCursor("2026-09-17T01:00:00.000Z|wa-abc")).toEqual({
      at: "2026-09-17T01:00:00.000Z",
      key: "wa-abc",
    });
  });

  it("keeps everything after the first pipe as the key, even if the key itself contains one", () => {
    expect(parseCursor("2026-09-17T01:00:00.000Z|em-a|b")).toEqual({
      at: "2026-09-17T01:00:00.000Z",
      key: "em-a|b",
    });
  });

  it("returns null for null/undefined/empty input", () => {
    expect(parseCursor(null)).toBeNull();
    expect(parseCursor(undefined)).toBeNull();
    expect(parseCursor("")).toBeNull();
  });

  it("returns null when there is no pipe", () => {
    expect(parseCursor("no-pipe-here")).toBeNull();
  });

  it("returns null when either half is empty", () => {
    expect(parseCursor("|wa-abc")).toBeNull();
    expect(parseCursor("2026-09-17T01:00:00.000Z|")).toBeNull();
  });
});

describe("isAfterCursor", () => {
  it("always passes when there is no cursor (first page)", () => {
    expect(isAfterCursor("2026-09-17T01:00:00.000Z", "wa-1", null)).toBe(true);
  });

  it("passes items with an earlier `at` (sorts later, desc)", () => {
    const cursor = { at: "2026-09-17T01:00:00.000Z", key: "wa-1" };
    expect(isAfterCursor("2026-09-16T01:00:00.000Z", "wa-9", cursor)).toBe(true);
  });

  it("blocks items with a later `at`", () => {
    const cursor = { at: "2026-09-17T01:00:00.000Z", key: "wa-1" };
    expect(isAfterCursor("2026-09-18T01:00:00.000Z", "wa-0", cursor)).toBe(false);
  });

  it("on a tied `at`, passes only keys that sort after the cursor's key (asc)", () => {
    const cursor = { at: "2026-09-17T01:00:00.000Z", key: "wa-b" };
    expect(isAfterCursor("2026-09-17T01:00:00.000Z", "wa-c", cursor)).toBe(true);
    expect(isAfterCursor("2026-09-17T01:00:00.000Z", "wa-a", cursor)).toBe(false);
    expect(isAfterCursor("2026-09-17T01:00:00.000Z", "wa-b", cursor)).toBe(false); // the cursor item itself
  });

  it("never duplicates or drops items across a simulated page boundary", () => {
    // Five items tied on the same `at`, sorted by key asc (mergeItems' order).
    const at = "2026-09-17T01:00:00.000Z";
    const keys = ["wa-a", "wa-b", "wa-c", "wa-d", "wa-e"];
    // Page 1 returns the first three; cursor = last item of page 1.
    const page1 = keys.slice(0, 3);
    const cursor = { at, key: page1[page1.length - 1] };
    const page2 = keys.filter((k) => isAfterCursor(at, k, cursor));
    expect(page2).toEqual(["wa-d", "wa-e"]);
    // No overlap, no gap.
    expect(new Set([...page1, ...page2])).toEqual(new Set(keys));
  });
});
