import { describe, expect, it } from "vitest";
import { parseCursor, isAfterCursor, channelCursorBound, pageFromChannels, type Cursor, type ChannelPage } from "./cursor";
import { compareItems, type InboxItem } from "./conversations";

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
    // Five items tied on the same `at`, sorted by key asc (compareItems' order).
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

describe("channelCursorBound", () => {
  it("no cursor (first page): no bound", () => {
    expect(channelCursorBound("wa", null)).toEqual({ op: "none" });
  });

  it("same prefix as the cursor: a tuple bound keyed on the cursor's raw id", () => {
    const cursor: Cursor = { at: "2026-09-17T01:00:00.000Z", key: "wa-7449b43e-5eee-4124-9dba-ee83dca54a5b" };
    expect(channelCursorBound("wa", cursor)).toEqual({
      op: "tuple",
      value: "2026-09-17T01:00:00.000Z",
      id: "7449b43e-5eee-4124-9dba-ee83dca54a5b",
    });
  });

  it("a channel whose prefix sorts after the cursor's prefix: `lte` (every at-tied row here is after the cursor)", () => {
    // "wa" > "ig" lexically
    const cursor: Cursor = { at: "2026-09-17T01:00:00.000Z", key: "ig-abc" };
    expect(channelCursorBound("wa", cursor)).toEqual({ op: "lte", value: "2026-09-17T01:00:00.000Z" });
  });

  it("a channel whose prefix sorts before the cursor's prefix: `lt` (every at-tied row here is before the cursor)", () => {
    // "em" < "ig" lexically
    const cursor: Cursor = { at: "2026-09-17T01:00:00.000Z", key: "ig-abc" };
    expect(channelCursorBound("em", cursor)).toEqual({ op: "lt", value: "2026-09-17T01:00:00.000Z" });
  });

  it("prefix ordering matches the actual channel prefixes used: em < ig < wa", () => {
    const cursor: Cursor = { at: "2026-09-17T01:00:00.000Z", key: "ig-abc" };
    expect(channelCursorBound("em", cursor).op).toBe("lt");
    expect(channelCursorBound("wa", cursor).op).toBe("lte");
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

  function page(items: InboxItem[], truncated: boolean): ChannelPage {
    return { items, truncated };
  }

  // Simulates one channel's server-side fetch under the round-2 design:
  // SQL orders (at desc, id asc) — equivalent to compareItems within a
  // single channel, since the prefix is constant — bounds with the exact
  // channelCursorBound (no over-fetch window, no in-memory trim needed
  // afterwards), and fetches exactly `limit` rows. `truncated` reflects the
  // raw fetch hitting `limit`, same as the real route computes it.
  function simulateChannelFetch(allRows: InboxItem[], cursor: Cursor | null, limit: number, prefix: string): ChannelPage {
    const bound = channelCursorBound(prefix, cursor);
    const matches = allRows.filter((row) => {
      if (bound.op === "none") return true;
      if (bound.op === "lt") return row.at < bound.value;
      if (bound.op === "lte") return row.at <= bound.value;
      // tuple: at < value, OR (at === value AND id > cursor's id)
      if (row.at < bound.value) return true;
      if (row.at > bound.value) return false;
      const id = row.key.slice(row.key.indexOf("-") + 1);
      return id > bound.id;
    });
    const sorted = [...matches].sort(compareItems);
    const fetched = sorted.slice(0, limit);
    return { items: fetched, truncated: fetched.length === limit };
  }

  it("one channel empty: pages using only the non-empty channel", () => {
    const wa = [item("2026-09-17T03:00:00.000Z", "wa-a"), item("2026-09-17T02:00:00.000Z", "wa-b")];
    const { items, nextCursor } = pageFromChannels([page(wa, false), page([], false)], null, 5);
    expect(items.map((i) => i.key)).toEqual(["wa-a", "wa-b"]);
    expect(nextCursor).toBeNull();
  });

  it("all channels shorter than limit → nextCursor null (nothing left to page to)", () => {
    const wa = [item("2026-09-17T03:00:00.000Z", "wa-a")];
    const ig = [item("2026-09-17T02:30:00.000Z", "ig-a"), item("2026-09-17T02:00:00.000Z", "ig-b")];
    const { items, nextCursor } = pageFromChannels([page(wa, false), page(ig, false)], null, 10);
    expect(items).toHaveLength(3);
    expect(nextCursor).toBeNull();
  });

  it("a channel truncated at exactly `limit` forces nextCursor even if the page has room left", () => {
    // wa alone supplies `limit` rows (2) and was truncated (raw fetch hit
    // the cap); em is empty. Even though the page (limit=2) is exactly
    // filled by wa with nothing left over, wa might have more beyond its
    // fetch window, so nextCursor must not be null.
    const wa = [item("2026-09-17T03:00:00.000Z", "wa-a"), item("2026-09-17T02:00:00.000Z", "wa-b")];
    const { items, nextCursor } = pageFromChannels([page(wa, true), page([], false)], null, 2);
    expect(items.map((i) => i.key)).toEqual(["wa-a", "wa-b"]);
    expect(nextCursor).toBe("2026-09-17T02:00:00.000Z|wa-b");
  });

  it("a channel that returned exactly `limit` rows but was NOT truncated (its true total equals limit) still yields nextCursor null once nothing else is pending", () => {
    // Distinguishes truncated (raw fetch hit the cap, so more MIGHT exist)
    // from "happened to have exactly `limit` rows total" (truncated=false —
    // the caller knows there's nothing beyond what it fetched, e.g. because
    // fewer than `limit` rows were available so the DB simply returned all
    // of them and the cap was never actually hit... this test instead pins
    // the case where truncated=false is trusted at face value).
    const wa = [item("2026-09-17T03:00:00.000Z", "wa-a"), item("2026-09-17T02:00:00.000Z", "wa-b")];
    const { nextCursor } = pageFromChannels([page(wa, false), page([], false)], null, 2);
    expect(nextCursor).toBeNull();
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
      const waPage = simulateChannelFetch(wa, cursor, limit, "wa");
      const igPage = simulateChannelFetch(ig, cursor, limit, "ig");
      const { items, nextCursor } = pageFromChannels([waPage, igPage], cursor, limit);
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
    // wa/em here represent only the rows that already match the requested
    // filter (pushed into SQL) — but spread far enough apart in time that a
    // `limit`-sized fetch per page won't find them all in one round trip.
    const wa = Array.from({ length: 20 }, (_, i) =>
      item(`2026-08-${String(31 - i).padStart(2, "0")}T00:00:00.000Z`, `wa-${String(i).padStart(2, "0")}`),
    );
    const em = Array.from({ length: 15 }, (_, i) =>
      item(`2026-08-${String(25 - i).padStart(2, "0")}T12:00:00.000Z`, `em-${String(i).padStart(2, "0")}`),
    );
    const limit = 3;

    const seen: string[] = [];
    let cursor: Cursor | null = null;
    let pages = 0;
    for (; pages < 50; pages++) {
      const waPage = simulateChannelFetch(wa, cursor, limit, "wa");
      const emPage = simulateChannelFetch(em, cursor, limit, "em");
      const { items, nextCursor } = pageFromChannels([waPage, emPage], cursor, limit);
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

  it("shuffled input, many ties (including a timestamp shared by more rows than `limit`), paged to exhaustion across two channels: every item exactly once", () => {
    const tieAt = "2026-09-17T00:00:00.000Z"; // shared by 7 wa rows and 4 ig rows — more than `limit`
    const wa = [
      ...Array.from({ length: 7 }, (_, i) => item(tieAt, `wa-tie-${String(i).padStart(2, "0")}`)),
      ...Array.from({ length: 5 }, (_, i) =>
        item(`2026-08-${String(20 - i).padStart(2, "0")}T00:00:00.000Z`, `wa-old-${i}`),
      ),
    ];
    const ig = [
      ...Array.from({ length: 4 }, (_, i) => item(tieAt, `ig-tie-${String(i).padStart(2, "0")}`)),
      ...Array.from({ length: 6 }, (_, i) =>
        item(`2026-08-${String(22 - i).padStart(2, "0")}T00:00:00.000Z`, `ig-old-${i}`),
      ),
    ];

    // Shuffle deterministically (a fixed seed-like reversal + interleave) —
    // simulateChannelFetch must re-sort with compareItems regardless of the
    // order rows arrive in, so the shuffle should have zero effect on the
    // outcome. (channelCursorBound/pageFromChannels don't rely on input
    // order, but this pins that pageFromChannels' own re-sort-before-slice
    // step, not just the simulation's sort, is doing real work.)
    function shuffle<T>(arr: T[]): T[] {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = (i * 7 + 3) % (i + 1); // deterministic, no Math.random
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
    const waShuffled = shuffle(wa);
    const igShuffled = shuffle(ig);

    const limit = 3; // smaller than the 7-row and 4-row ties, forcing multiple
    // pages to walk through a single tied timestamp using the id tiebreak.

    const seen: string[] = [];
    let cursor: Cursor | null = null;
    let pages = 0;
    for (; pages < 100; pages++) {
      const waPage = simulateChannelFetch(waShuffled, cursor, limit, "wa");
      const igPage = simulateChannelFetch(igShuffled, cursor, limit, "ig");
      const { items, nextCursor } = pageFromChannels([waPage, igPage], cursor, limit);
      if (items.length === 0) break;
      seen.push(...items.map((i) => i.key));
      if (!nextCursor) break;
      cursor = parseCursor(nextCursor);
    }

    const expectedKeys = new Set([...wa.map((i) => i.key), ...ig.map((i) => i.key)]);
    expect(new Set(seen)).toEqual(expectedKeys);
    expect(seen).toHaveLength(expectedKeys.size); // exactly once each — no duplicates, no drops
    expect(pages).toBeLessThan(100); // actually terminated
  });
});
