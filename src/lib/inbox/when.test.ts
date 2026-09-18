import { describe, expect, it } from "vitest";
import { formatWhen } from "./when";

describe("formatWhen", () => {
  const now = new Date("2026-09-18T12:00:00.000Z");

  it("renders minutes under an hour", () => {
    expect(formatWhen(new Date(now.getTime() - 2 * 60_000).toISOString(), now)).toBe("2m");
  });

  it("renders at least 1m for anything under a minute", () => {
    expect(formatWhen(new Date(now.getTime() - 10_000).toISOString(), now)).toBe("1m");
  });

  it("renders hours under a day", () => {
    expect(formatWhen(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now)).toBe("3h");
  });

  it("renders days under a week", () => {
    expect(formatWhen(new Date(now.getTime() - 2 * 86_400_000).toISOString(), now)).toBe("2d");
  });

  it("falls back to an IST short date at a week or older", () => {
    // now = 18 Sep 12:00 UTC = 17:30 IST; 8 days earlier lands well clear of
    // any timezone-boundary flakiness.
    const iso = new Date(now.getTime() - 8 * 86_400_000).toISOString();
    expect(formatWhen(iso, now)).toBe("10 Sep");
  });

  it("returns empty string for an unparseable timestamp", () => {
    expect(formatWhen("not-a-date", now)).toBe("");
  });
});
