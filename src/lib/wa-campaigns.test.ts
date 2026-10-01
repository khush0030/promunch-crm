import { describe, expect, it } from "vitest";
import {
  basicInputErrors,
  contentEditable,
  etaDays,
  followupAudienceFilter,
  followupEditable,
  followupInitialStatus,
  followupParentError,
  journeyRootId,
  journeyDuplicateError,
  JOURNEY_DUPLICATE_ERROR,
  normalizeVars,
  needsFollowupSql,
  normalizeAudienceFilter,
  orderJourney,
  parseFollowupInput,
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
  it("an armed follow-up that never started resumes to armed, not sending", () => {
    const t = planTransition("resume", { status: "paused", started_at: null, followup_of: "p" }, NOW);
    expect(t).toMatchObject({ ok: true, patch: { status: "scheduled" }, kick: false });
    const started = planTransition("resume", { status: "paused", started_at: "2026-09-28T00:00:00Z", followup_of: "p" }, NOW);
    expect(started).toMatchObject({ ok: true, patch: { status: "sending" }, kick: true });
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

const PID = "123e4567-e89b-12d3-a456-426614174000";

describe("follow-up input", () => {
  it("is all three or none", () => {
    expect(parseFollowupInput({})).toEqual({ ok: true, followup: null });
    expect(parseFollowupInput({ followup_of: PID }).ok).toBe(false);
    expect(parseFollowupInput({ followup_of: PID, followup_after_hours: 48 }).ok).toBe(false);
    expect(parseFollowupInput({ followup_of: PID, followup_after_hours: 48, followup_stage: "read" })).toEqual({
      ok: true, followup: { followup_of: PID, followup_after_hours: 48, followup_stage: "read" },
    });
  });
  it("validates hours 1..720 and the stage list", () => {
    const base = { followup_of: PID, followup_stage: "read" };
    expect(parseFollowupInput({ ...base, followup_after_hours: 0 }).ok).toBe(false);
    expect(parseFollowupInput({ ...base, followup_after_hours: 721 }).ok).toBe(false);
    expect(parseFollowupInput({ ...base, followup_after_hours: 1.5 }).ok).toBe(false);
    expect(parseFollowupInput({ ...base, followup_after_hours: 720 }).ok).toBe(true);
    expect(parseFollowupInput({ followup_of: PID, followup_after_hours: 24, followup_stage: "not_delivered" }).ok).toBe(false);
    expect(parseFollowupInput({ followup_of: "nope", followup_after_hours: 24, followup_stage: "read" }).ok).toBe(false);
  });
  it("builds the one audience a follow-up may have, and the engine's normaliser keeps it", () => {
    const f = followupAudienceFilter({ followup_of: PID, followup_after_hours: 48, followup_stage: "ordered" });
    expect(f).toEqual({ retarget: { campaign_id: PID, stage: "ordered", min_hours_since: 48 } });
    expect(normalizeAudienceFilter(f)).toEqual({ ok: true, filter: f });
    expect(needsFollowupSql(f)).toBe(true);
    expect(needsFollowupSql({ retarget: { campaign_id: PID, stage: "not_read" } })).toBe(false);
    expect(needsFollowupSql({ tags: ["x"] })).toBe(false);
    expect(normalizeAudienceFilter({ retarget: { campaign_id: PID, stage: "read", min_hours_since: -1 } }).ok).toBe(false);
  });
  it("status and parent rules", () => {
    expect(followupInitialStatus("draft")).toBe("draft");
    expect(followupInitialStatus("scheduled")).toBe("scheduled");
    expect(followupInitialStatus("completed")).toBe("scheduled");
    expect(followupParentError(null)).toMatch(/no longer exists/);
    expect(followupParentError({ status: "cancelled" })).toMatch(/cancelled/);
    expect(followupParentError({ status: "failed" })).toMatch(/failed/);
    expect(followupParentError({ status: "scheduled", repeat_rule: "weekly" })).toMatch(/repeating/);
    expect(followupParentError({ status: "completed", started_at: "2026-08-01T00:00:00Z" }, NOW)).toMatch(/30 days/);
    expect(followupParentError({ status: "sending", started_at: "2026-09-28T00:00:00Z" }, NOW)).toBeNull();
    expect(followupEditable("scheduled", 0)).toBe(true);
    expect(followupEditable("sending", 0)).toBe(true);
    expect(followupEditable("sending", 1)).toBe(false);
    expect(followupEditable("completed", 0)).toBe(false);
  });
  it("a never-started follow-up resumes to armed, not sending", () => {
    expect(planTransition("resume", { status: "paused", followup_of: PID, started_at: null }, NOW))
      .toMatchObject({ ok: true, patch: { status: "scheduled" }, kick: false });
    expect(planTransition("resume", { status: "paused", followup_of: PID, started_at: "2026-09-28T00:00:00Z" }, NOW))
      .toMatchObject({ ok: true, patch: { status: "sending" }, kick: true });
  });
});

describe("journey ordering", () => {
  const rows = [
    { id: "c", followup_of: "a", created_at: "2026-09-30T03:00:00Z" },
    { id: "a", followup_of: null, created_at: "2026-09-30T01:00:00Z" },
    { id: "b", followup_of: "a", created_at: "2026-09-30T02:00:00Z" },
    { id: "d", followup_of: "b", created_at: "2026-09-30T04:00:00Z" },
  ];
  it("walks up to the root and lists parent first, siblings oldest first", () => {
    const map = new Map(rows.map((r) => [r.id, r]));
    expect(journeyRootId(map, "d")).toBe("a");
    expect(orderJourney(rows, "a").map((s) => [s.row.id, s.depth, s.parent_id])).toEqual([
      ["a", 0, null], ["b", 1, "a"], ["d", 2, "b"], ["c", 1, "a"],
    ]);
  });
  it("refuses only an IDENTICAL message in a journey (template + blanks + picture)", () => {
    const parent = { template_id: "img", template_vars: { "1": "Hi {name}", _track_url: "https://promunch.in/x" }, header_media_url: "https://c/a.jpg" };
    // same template, same text (key order + whitespace ignored), same picture -> refused
    expect(journeyDuplicateError(
      { template_id: "img", template_vars: { _track_url: " https://promunch.in/x ", "1": "Hi {name} " }, header_media_url: "https://c/a.jpg" },
      [parent],
    )).toBe(JOURNEY_DUPLICATE_ERROR);
    // same template, different picture -> allowed
    expect(journeyDuplicateError({ ...parent, header_media_url: "https://c/b.jpg" }, [parent])).toBeNull();
    // same template, different blank text -> allowed
    expect(journeyDuplicateError({ ...parent, template_vars: { ...parent.template_vars, "1": "Still thinking?" } }, [parent])).toBeNull();
    // different template -> allowed
    expect(journeyDuplicateError({ ...parent, template_id: "other" }, [parent])).toBeNull();
  });
  it("a null picture override means the template default", () => {
    const withDefault = { template_id: "img", template_vars: {}, header_media_url: null };
    const explicit = { template_id: "img", template_vars: {}, header_media_url: "https://c/default.jpg" };
    expect(journeyDuplicateError(withDefault, [explicit], "https://c/default.jpg")).toBe(JOURNEY_DUPLICATE_ERROR);
    expect(journeyDuplicateError(explicit, [withDefault], "https://c/default.jpg")).toBe(JOURNEY_DUPLICATE_ERROR);
    expect(journeyDuplicateError({ ...withDefault, header_media_url: "https://c/new.jpg" }, [withDefault], "https://c/default.jpg")).toBeNull();
    // no vars vs {} are the same
    expect(normalizeVars(null)).toBe(normalizeVars({}));
  });
  it("a different tracked-link destination alone is still the same message on the phone", () => {
    const a = { template_id: "img", template_vars: { "1": "Hi", _track_url: "https://promunch.in/a" }, header_media_url: null };
    const b = { template_id: "img", template_vars: { "1": "Hi", _track_url: "https://promunch.in/b" }, header_media_url: null };
    const noLink = { template_id: "img", template_vars: { "1": "Hi" }, header_media_url: null };
    expect(journeyDuplicateError(b, [a])).toBe(JOURNEY_DUPLICATE_ERROR);
    expect(journeyDuplicateError(noLink, [a])).toBe(JOURNEY_DUPLICATE_ERROR);
    // the AI brief changes the text: not the same message
    expect(journeyDuplicateError({ ...a, template_vars: { ...a.template_vars, _ai_brief: "warmer" } }, [a])).toBeNull();
  });
});
