import { describe, expect, it } from "vitest";
import { parseCursor, isAfterCursor, pageFromChannels, type Cursor } from "./cursor";
import type { InboxItem } from "./conversations";

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

describe("pageFromChannels", () => {
  function item(at: string, key: string): InboxItem {
    return {
      key,
      channel: key.startsWith("wa-") ? "wa" : key.startsWith("ig-") ? "ig" : "em",
      name: key,
      preview: "",
      at,
      pill: { tone: "info", text: "Bot" },
      needsHuman: false,
      assignee: null,
      bot: false,
      unread: 0,
    };
  }

  // Simulates one channel's server-side fetch: rows already sorted `at` desc
  // (as the SQL query would return them), bounded to `at <= cursor.at`,
  // capped to a `limit + 10` window, then isAfterCursor-filtered — exactly
  // what src/app/api/inbox/conversations/route.ts does per channel before
  // handing the result to pageFromChannels.
  function channelWindow(allDesc: InboxItem[], cursor: Cursor | null, limit: number): InboxItem[] {
    const bounded = cursor ? allDesc.filter((i) => i.at <= cursor.at) : allDesc;
    const fetched = bounded.slice(0, limit + 10);
    return fetched.filter((i) => isAfterCursor(i.at, i.key, cursor));
  }

  it("one channel empty: pages using only the non-empty channel", () => {
    const wa = [item("2026-09-17T03:00:00.000Z", "wa-a"), item("2026-09-17T02:00:00.000Z", "wa-b")];
    const { items, nextCursor } = pageFromChannels([wa, []], null, 5);
    expect(items.map((i) => i.key)).toEqual(["wa-a", "wa-b"]);
    expect(nextCursor).toBeNull();
  });

  it("all channels shorter than limit → nextCursor null (nothing left to page to)", () => {
    const wa = [item("2026-09-17T03:00:00.000Z", "wa-a")];
    const ig = [item("2026-09-17T02:30:00.000Z", "ig-a"), item("2026-09-17T02:00:00.000Z", "ig-b")];
    const { items, nextCursor } = pageFromChannels([wa, ig], null, 10);
    expect(items).toHaveLength(3);
    expect(nextCursor).toBeNull();
  });

  it("a channel hitting exactly `limit` after-cursor rows forces nextCursor even if the page has room left", () => {
    // wa alone supplies `limit` rows (2); em is empty. Even though the page
    // (limit=2) is exactly filled by wa with nothing left over, wa might
    // have more beyond its fetch window, so nextCursor must not be null.
    const wa = [item("2026-09-17T03:00:00.000Z", "wa-a"), item("2026-09-17T02:00:00.000Z", "wa-b")];
    const { items, nextCursor } = pageFromChannels([wa, []], null, 2);
    expect(items.map((i) => i.key)).toEqual(["wa-a", "wa-b"]);
    expect(nextCursor).toBe("2026-09-17T02:00:00.000Z|wa-b");
  });

  it("boundary tie at the page edge: items tied on `at` across two channels are neither duplicated nor dropped", () => {
    const at = "2026-09-17T03:00:00.000Z";
    // 5 items total tied on the same `at`, split across two channels.
    const wa = [item(at, "wa-a"), item(at, "wa-c"), item(at, "wa-e")];
    const ig = [item(at, "ig-b"), item(at, "ig-d")];
    const limit = 2;

    const seen: string[] = [];
    let cursor: Cursor | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const waWindow = channelWindow(wa, cursor, limit);
      const igWindow = channelWindow(ig, cursor, limit);
      const { items, nextCursor } = pageFromChannels([waWindow, igWindow], cursor, limit);
      seen.push(...items.map((i) => i.key));
      if (!nextCursor) break;
      cursor = parseCursor(nextCursor);
    }

    // "ig-*" sorts before "wa-*" lexically, so on this all-tied-at set the
    // key-asc order interleaves the two channels: ig-b, ig-d, then wa-a,
    // wa-c, wa-e.
    expect(seen).toEqual(["ig-b", "ig-d", "wa-a", "wa-c", "wa-e"]);
    expect(new Set(seen).size).toBe(5); // no duplicates
  });

  it("sparse filter over two channels, paged to exhaustion, yields every item exactly once", () => {
    // wa has matches scattered across a long, mostly-non-matching history —
    // simulating filter=human where most recent rows don't need a human.
    // Because the filter is pushed into SQL now, `wa`/`em` here represent
    // only the rows that *do* match — but they're spread far enough apart in
    // time that a small `limit + 10` fetch window won't find all of them at
    // once, forcing several pagination round-trips.
    const wa = Array.from({ length: 20 }, (_, i) =>
      item(`2026-08-${String(31 - i).padStart(2, "0")}T00:00:00.000Z`, `wa-${String(i).padStart(2, "0")}`),
    );
    const em = Array.from({ length: 15 }, (_, i) =>
      item(`2026-08-${String(25 - i).padStart(2, "0")}T12:00:00.000Z`, `em-${String(i).padStart(2, "0")}`),
    );
    const limit = 3; // window = limit + 10 = 13, smaller than either channel's
    // full history, so channelWindow genuinely truncates and this exercises
    // the "capped window, re-fetch from the new cursor" path, not just
    // mergeItems' own limit slicing.

    const seen: string[] = [];
    let cursor: Cursor | null = null;
    let pages = 0;
    for (; pages < 50; pages++) {
      const waWindow = channelWindow(wa, cursor, limit);
      const emWindow = channelWindow(em, cursor, limit);
      const { items, nextCursor } = pageFromChannels([waWindow, emWindow], cursor, limit);
      if (items.length === 0) break;
      seen.push(...items.map((i) => i.key));
      if (!nextCursor) break;
      cursor = parseCursor(nextCursor);
    }

    const expectedKeys = new Set([...wa.map((i) => i.key), ...em.map((i) => i.key)]);
    expect(new Set(seen)).toEqual(expectedKeys);
    expect(seen).toHaveLength(expectedKeys.size); // exactly once each, no duplicates
    expect(pages).toBeLessThan(50); // actually terminated
  });
});
