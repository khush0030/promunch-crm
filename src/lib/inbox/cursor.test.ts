import { describe, expect, it } from "vitest";
import { parseCursor, channelCursorBound, pageFromChannels, type Cursor, type ChannelPage } from "./cursor";
import { compareItems, type AtKey, type InboxItem } from "./conversations";

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

  function page(items: InboxItem[], truncated: boolean, rawLast: AtKey | null = null): ChannelPage {
    // Most tests don't care about the rawLast fallback path, so default it
    // to the natural value (the last item, if any) unless a test explicitly
    // wants to simulate "every raw row got dropped" (rawLast set, items empty).
    return { items, truncated, rawLast: rawLast ?? (items.length ? items[items.length - 1] : null) };
  }

  // Simulates one channel's server-side fetch: SQL orders (at desc, id asc)
  // — equivalent to compareItems within a single channel, since the prefix
  // is constant — bounds with the exact channelCursorBound, and fetches
  // `limit + 1` raw rows so a fetch of exactly `limit` rows (no more
  // available) is distinguishable from a fetch that filled the whole window
  // (more may exist beyond it). `truncated` is true only in the latter case;
  // the raw fetch is then capped to `limit` before returning.
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
    const raw = sorted.slice(0, limit + 1);
    const truncated = raw.length > limit;
    const fetched = raw.slice(0, limit);
    const rawLast = fetched.length ? fetched[fetched.length - 1] : null;
    return { items: fetched, truncated, rawLast };
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

  it("a channel with exactly `limit` total rows (not truncated) still yields nextCursor null once nothing else is pending", () => {
    // With a `limit + 1` fetch, truncated=false and items.length===limit at
    // the same time is a perfectly ordinary outcome: it means the channel
    // had exactly `limit` matching rows and no more (the DB simply had
    // nothing left to fill the +1 slot with) — not an edge case.
    const wa = [item("2026-09-17T03:00:00.000Z", "wa-a"), item("2026-09-17T02:00:00.000Z", "wa-b")];
    const { nextCursor } = pageFromChannels([page(wa, false), page([], false)], null, 2);
    expect(nextCursor).toBeNull();
  });

  it("every row a truncated channel fetched got dropped (items empty): still emits a cursor from that channel's raw last row, so paging continues instead of silently stopping", () => {
    // Simulates the consistency-guard/hasAt drop path in the route: the
    // channel's raw fetch found 2 rows and was truncated (there may be
    // more), but by the time route.ts's filters ran, both were dropped —
    // so `items` is empty. Without the rawLast fallback, `more` would still
    // be true (anyTruncated) but there'd be no item to build a cursor from,
    // and paging would stop even though more data exists.
    const rawLast: AtKey = { at: "2026-09-17T02:00:00.000Z", key: "wa-b" };
    const dropped = page([], true, rawLast);
    const { items, nextCursor } = pageFromChannels([dropped], null, 2);
    expect(items).toEqual([]);
    expect(nextCursor).toBe("2026-09-17T02:00:00.000Z|wa-b");
  });

  it("rawLast is ignored whenever `items` is non-empty — even if a different, fully-dropped channel's rawLast would sort further along", () => {
    // ig has 2 visible items (not truncated); wa's whole fetch got dropped
    // but was truncated, with a rawLast that sorts FURTHER along than ig's
    // own last item. If that rawLast were blended into the boundary choice,
    // the cursor would jump past rows wa hasn't actually shown yet on a
    // future page (a real bug an earlier draft had) — so as long as `items`
    // isn't empty, the merged page's own last item is the only boundary
    // used, full stop.
    const ig = [item("2026-09-17T05:00:00.000Z", "ig-a"), item("2026-09-17T01:00:00.000Z", "ig-b")];
    const waRawLast: AtKey = { at: "2026-08-01T00:00:00.000Z", key: "wa-x" }; // sorts further along than ig-b
    const { items, nextCursor } = pageFromChannels([page(ig, false), page([], true, waRawLast)], null, 10);
    expect(items.map((i) => i.key)).toEqual(["ig-a", "ig-b"]);
    expect(nextCursor).toBe("2026-09-17T01:00:00.000Z|ig-b");
  });

  it("when `items` is empty and multiple channels were truncated-and-fully-dropped, the LEAST advanced rawLast is used — never the most advanced (which could skip the less-advanced channel's still-unexplored rows)", () => {
    const aheadRawLast: AtKey = { at: "2026-08-01T00:00:00.000Z", key: "wa-x" }; // further along
    const behindRawLast: AtKey = { at: "2026-09-10T00:00:00.000Z", key: "ig-y" }; // less far along
    const { items, nextCursor } = pageFromChannels(
      [page([], true, aheadRawLast), page([], true, behindRawLast)],
      null,
      10,
    );
    expect(items).toEqual([]);
    expect(nextCursor).toBe("2026-09-10T00:00:00.000Z|ig-y");
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

  it("pageFromChannels sorts each channel's rows before capping to `limit` — unsorted ChannelPage input still keeps the correct top rows, not just the first `limit` array elements", () => {
    // Passed directly (not through simulateChannelFetch, which sorts on the
    // way in) so this exercises pageFromChannels' OWN sort, not the test
    // helper's. Deliberately shuffled so "the first `limit` elements" of the
    // raw array is NOT the correct answer.
    const at = "2026-09-17T00:00:00.000Z";
    const waUnsorted = [item(at, "wa-d"), item(at, "wa-b"), item(at, "wa-e"), item(at, "wa-a"), item(at, "wa-c")];
    const { items, nextCursor } = pageFromChannels([{ items: waUnsorted, truncated: true, rawLast: null }], null, 2);
    // Correct top-2 by compareItems (at tied, key asc) are wa-a, wa-b — NOT
    // wa-d, wa-b (the literal first two elements of the unsorted array).
    expect(items.map((i) => i.key)).toEqual(["wa-a", "wa-b"]);
    expect(nextCursor).toBe(`${at}|wa-b`);
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

    // Shuffle deterministically (a fixed permutation, no Math.random) —
    // simulateChannelFetch re-sorts with compareItems regardless of the
    // order rows arrive in, so the shuffle should have zero effect on the
    // outcome; the standalone test above pins pageFromChannels' own re-sort
    // more directly (unsorted input with no upstream sort at all).
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
