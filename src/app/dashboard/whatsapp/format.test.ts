import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { msgTime, mostRecent, timeAgo, templateVars } from "./format";

describe("msgTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00+05:30"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns empty string for null", () => {
    expect(msgTime(null)).toBe("");
  });

  it("shows only the clock time for a message from today", () => {
    const s = msgTime("2026-07-05T09:15:00+05:30");
    expect(s).toMatch(/9:15/i);
    expect(s).not.toMatch(/Jul/);
  });

  it("prefixes day and month for a message from another day", () => {
    const s = msgTime("2026-05-22T17:42:00+05:30");
    expect(s).toMatch(/22 May/);
    expect(s).toMatch(/5:42/);
  });
});

describe("mostRecent", () => {
  const older = "2026-07-01T00:00:00Z";
  const newer = "2026-07-04T00:00:00Z";

  it("returns the later of two timestamps", () => {
    expect(mostRecent(older, newer)).toBe(newer);
    expect(mostRecent(newer, older)).toBe(newer);
  });

  it("falls back to the non-null side", () => {
    expect(mostRecent(null, newer)).toBe(newer);
    expect(mostRecent(older, null)).toBe(older);
    expect(mostRecent(null, null)).toBeNull();
  });

  it("prefers the first argument on a tie", () => {
    expect(mostRecent(older, older)).toBe(older);
  });
});

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00+05:30"));
  });
  afterEach(() => vi.useRealTimers());

  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("returns em dash for null", () => {
    expect(timeAgo(null)).toBe("—");
  });

  it("formats seconds, minutes, hours, days", () => {
    expect(timeAgo(ago(30_000))).toBe("30s");
    expect(timeAgo(ago(5 * 60_000))).toBe("5m");
    expect(timeAgo(ago(3 * 3_600_000))).toBe("3h");
    expect(timeAgo(ago(4 * 86_400_000))).toBe("4d");
  });

  it("falls back to a date past 30 days", () => {
    expect(timeAgo(ago(45 * 86_400_000))).toMatch(/May/);
  });
});

describe("templateVars", () => {
  it("returns empty for null/undefined/plain text", () => {
    expect(templateVars(null)).toEqual([]);
    expect(templateVars(undefined)).toEqual([]);
    expect(templateVars("no vars here")).toEqual([]);
  });

  it("extracts distinct indices sorted numerically", () => {
    expect(templateVars("Hi {{2}}, your order {{1}} ({{10}}) — {{2}} again")).toEqual([
      "1",
      "2",
      "10",
    ]);
  });

  it("ignores malformed placeholders", () => {
    expect(templateVars("{{a}} {1} {{ 2 }}")).toEqual([]);
  });
});
