import { describe, expect, it } from "vitest";
import {
  basicInputErrors,
  contentEditable,
  etaDays,
  normalizeAudienceFilter,
  planTransition,
  templateInputErrors,
} from "./wa-campaigns";

const NOW = Date.parse("2026-09-29T08:00:00Z");

describe("planTransition", () => {
  it("pauses sending/scheduled only", () => {
    expect(planTransition("pause", { status: "sending" }, NOW)).toMatchObject({ ok: true, patch: { status: "paused" } });
    expect(planTransition("pause", { status: "completed" }, NOW)).toMatchObject({ ok: false, status: 409 });
  });
  it("resume of a never-started future campaign goes back to scheduled, no kick", () => {
    const t = planTransition("resume", { status: "paused", started_at: null, scheduled_at: "2026-10-01T00:00:00Z" }, NOW);
    expect(t).toMatchObject({ ok: true, patch: { status: "scheduled" }, kick: false });
  });
  it("resume of a started campaign re-drives it", () => {
    const t = planTransition("resume", { status: "paused", started_at: "2026-09-28T00:00:00Z" }, NOW);
    expect(t).toMatchObject({ ok: true, patch: { status: "sending", resume_at: null }, kick: true });
  });
  it("a recurring parent resumes to scheduled, never sends itself", () => {
    const t = planTransition("resume", { status: "paused", repeat_rule: "weekly", scheduled_at: "2026-09-01T00:00:00Z" }, NOW);
    expect(t).toMatchObject({ ok: true, patch: { status: "scheduled" }, kick: false });
  });
  it("cancel refuses finished campaigns", () => {
    expect(planTransition("cancel", { status: "completed" }, NOW).ok).toBe(false);
    expect(planTransition("cancel", { status: "paused" }, NOW)).toMatchObject({ ok: true, patch: { status: "cancelled" } });
  });
});

describe("contentEditable", () => {
  it("locks content once anyone was reached", () => {
    expect(contentEditable("draft", 0)).toBe(true);
    expect(contentEditable("paused", 0)).toBe(true);
    expect(contentEditable("paused", 3)).toBe(false);
    expect(contentEditable("failed", 0)).toBe(true);
    expect(contentEditable("sending", 0)).toBe(false);
  });
});

describe("normalizeAudienceFilter", () => {
  it("keeps legacy tags, adds new shapes, drops unknown keys", () => {
    const r = normalizeAudienceFilter({ tags: ["rfm:vip", "rfm:vip"], tags_all: ["a"], exclude_tags: ["b"], junk: 1 });
    expect(r).toEqual({ ok: true, filter: { tags: ["rfm:vip"], tags_all: ["a"], exclude_tags: ["b"] } });
    expect(normalizeAudienceFilter({})).toEqual({ ok: true, filter: {} });
    expect(normalizeAudienceFilter(null)).toEqual({ ok: true, filter: {} });
  });
  it("validates retarget", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(normalizeAudienceFilter({ retarget: { campaign_id: id, stage: "not_read" } }).ok).toBe(true);
    expect(normalizeAudienceFilter({ retarget: { campaign_id: id, stage: "nope" } }).ok).toBe(false);
    expect(normalizeAudienceFilter({ retarget: { campaign_id: "x", stage: "not_read" } }).ok).toBe(false);
    expect(normalizeAudienceFilter({ tags: "vip" }).ok).toBe(false);
  });
  it("keeps the warm engagement preset and refuses unknown presets", () => {
    expect(normalizeAudienceFilter({ engagement: "warm" })).toEqual({ ok: true, filter: { engagement: "warm" } });
    expect(normalizeAudienceFilter({ engagement: "cold" }).ok).toBe(false);
    expect(normalizeAudienceFilter({ engagement: "" })).toEqual({ ok: true, filter: {} });
  });
});

describe("input validation", () => {
  it("rejects AI mode with an empty brief (B10)", () => {
    expect(basicInputErrors({ template_vars: { _ai_brief: "  " } })).toHaveLength(1);
    expect(basicInputErrors({ template_vars: { _ai_brief: "Diwali" } })).toHaveLength(0);
    expect(basicInputErrors({ header_media_url: "http://x/a.jpg" })).toHaveLength(1);
  });
  it("uses the engine's template rules", () => {
    const tpl = { header_type: "IMAGE", header_media_url: "https://x/a.jpg", body: "Hi {{1}}" };
    expect(templateInputErrors(tpl, { "1": "there" }, "https://x/b.png")).toEqual([]);
    expect(templateInputErrors(tpl, { "1": "there" }, "https://x/b.mp4").length).toBe(1);
    expect(templateInputErrors(tpl, {}, null).length).toBe(1);
  });
});

describe("etaDays", () => {
  it("accounts for today's usage and non-campaign daily traffic", () => {
    expect(etaDays(0, 250, 0, 0)).toBe(0);
    expect(etaDays(100, 250, 100, 20)).toBe(1);
    expect(etaDays(1000, 250, 250, 50)).toBe(6); // 0 today, then 200/day
    expect(etaDays(10, null, 0, 0)).toBeNull();
  });
});
