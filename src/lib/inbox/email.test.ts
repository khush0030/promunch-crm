import { describe, it, expect } from "vitest";
import { tabOf, sortQueue, stepIndex, clipText, EMAIL_TABS } from "./email";

describe("tabOf", () => {
  it("puts pending emails that need a reply in To approve", () => {
    expect(tabOf({ status: "pending", should_reply: true })).toBe("approve");
    expect(tabOf({ status: "pending", should_reply: null })).toBe("approve");
  });

  it("puts pending emails the classifier said need no reply in No reply needed", () => {
    expect(tabOf({ status: "pending", should_reply: false })).toBe("noreply");
  });

  it("maps sent and skipped regardless of should_reply", () => {
    expect(tabOf({ status: "sent", should_reply: true })).toBe("sent");
    expect(tabOf({ status: "sent", should_reply: false })).toBe("sent");
    expect(tabOf({ status: "skipped", should_reply: null })).toBe("skipped");
  });

  it("returns null for in-flight or failed threads, so they are never approvable", () => {
    expect(tabOf({ status: "sending", should_reply: true })).toBeNull();
    expect(tabOf({ status: "failed", should_reply: true })).toBeNull();
    expect(tabOf({ status: "", should_reply: null })).toBeNull();
  });

  it("lists the four tabs in display order", () => {
    expect(EMAIL_TABS).toEqual(["approve", "noreply", "sent", "skipped"]);
  });
});

describe("sortQueue", () => {
  const row = (id: string, urgency: string | null, created_at: string) => ({ id, urgency, created_at });

  it("orders critical, then high, then everything else", () => {
    const out = sortQueue([
      row("m", "medium", "2026-09-20T01:00:00Z"),
      row("h", "high", "2026-09-20T02:00:00Z"),
      row("c", "critical", "2026-09-20T03:00:00Z"),
      row("n", null, "2026-09-20T00:00:00Z"),
    ]);
    expect(out.map((r) => r.id)).toEqual(["c", "h", "n", "m"]);
  });

  it("puts the oldest first inside a group", () => {
    const out = sortQueue([
      row("c2", "critical", "2026-09-20T05:00:00Z"),
      row("c1", "critical", "2026-09-20T01:00:00Z"),
      row("m2", "medium", "2026-09-19T05:00:00Z"),
      row("low1", "low", "2026-09-18T05:00:00Z"),
    ]);
    expect(out.map((r) => r.id)).toEqual(["c1", "c2", "low1", "m2"]);
  });

  it("does not mutate its input", () => {
    const input = [row("a", null, "2026-09-20T05:00:00Z"), row("b", "critical", "2026-09-20T06:00:00Z")];
    sortQueue(input);
    expect(input.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("stepIndex", () => {
  const ids = ["a", "b", "c"];

  it("finds a middle item with both neighbours", () => {
    expect(stepIndex(ids, "b")).toEqual({ index: 1, total: 3, prev: "a", next: "c" });
  });

  it("has no prev on the first item", () => {
    expect(stepIndex(ids, "a")).toEqual({ index: 0, total: 3, prev: null, next: "b" });
  });

  it("has no next on the last item", () => {
    expect(stepIndex(ids, "c")).toEqual({ index: 2, total: 3, prev: "b", next: null });
  });

  it("falls back to the first item when the id is missing or null", () => {
    expect(stepIndex(ids, "zzz")).toEqual({ index: 0, total: 3, prev: null, next: "b" });
    expect(stepIndex(ids, null)).toEqual({ index: 0, total: 3, prev: null, next: "b" });
  });

  it("handles an empty queue", () => {
    expect(stepIndex([], "a")).toEqual({ index: 0, total: 0, prev: null, next: null });
  });
});

describe("clipText", () => {
  it("leaves short text alone", () => {
    expect(clipText("hello", 1200)).toEqual({ text: "hello", clipped: false });
  });

  it("cuts long text at the limit and marks it clipped", () => {
    const long = "x".repeat(1300);
    const out = clipText(long, 1200);
    expect(out.clipped).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(1201);
    expect(out.text.endsWith("…")).toBe(true);
  });

  it("treats null as empty", () => {
    expect(clipText(null, 1200)).toEqual({ text: "", clipped: false });
  });
});
