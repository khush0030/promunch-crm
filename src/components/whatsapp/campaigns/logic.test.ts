import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIENCE,
  UNCHOSEN_AUDIENCE_TAG,
  allowedActions,
  audienceFromFilter,
  audienceProblems,
  breakdownRows,
  buildAudienceFilter,
  buildTemplateVars,
  contentProblems,
  csvContacts,
  effectiveStart,
  estimateOutcome,
  fillText,
  filterKey,
  initialVars,
  isColdAudience,
  listTagFor,
  matchesListFilter,
  normalizeTestNumber,
  pacing,
  parseCsv,
  parseIstInput,
  rememberNumber,
  sameFilter,
  scheduleProblems,
  sortTemplatesForGallery,
  templateFields,
  toCsv,
  toIstInput,
  typedCountMatches,
  type AudienceState,
  type CampaignTemplate,
} from "./logic";
import { GST_RATE, MARKETING_RATE_INR } from "./rates";

const tpl = (over: Partial<CampaignTemplate> = {}): CampaignTemplate => ({
  id: "t1",
  name: "diwali_offer",
  language: "en",
  category: "marketing",
  status: "approved",
  body: "Hi {{1}}, get {{2}} off this Diwali.",
  footer: "Reply STOP to unsubscribe",
  header_type: "IMAGE",
  header_text: null,
  header_media_url: "https://cdn.example.com/a.jpg",
  buttons: [{ type: "URL", text: "Shop now", url: "https://promunch.in/{{1}}", example: "https://promunch.in/collections/all" }],
  variables: [{ name: "1", sample: "Priya" }, { name: "2", sample: "15%" }],
  ...over,
});

const aud = (over: Partial<AudienceState>): AudienceState => ({ ...DEFAULT_AUDIENCE, ...over });

describe("audience filters", () => {
  it("defaults to Warm", () => {
    expect(buildAudienceFilter(DEFAULT_AUDIENCE)).toEqual({ engagement: "warm" });
  });

  it("builds every mode", () => {
    expect(buildAudienceFilter(aud({ mode: "engaged" }))).toEqual({ tags: ["tier:engaged"] });
    expect(buildAudienceFilter(aud({ mode: "segment", segments: ["vip", "first"] }))).toEqual({ tags: ["rfm:vip", "rfm:new", "rfm:one_time"] });
    expect(buildAudienceFilter(aud({ mode: "tags", tagsAny: ["a", "a", " "], tagsAll: ["b"], excludeTags: ["c"] }))).toEqual({
      tags: ["a"], tags_all: ["b"], exclude_tags: ["c"],
    });
    expect(buildAudienceFilter(aud({ mode: "retarget", retargetCampaignId: "x", retargetStage: "failed_cap" }))).toEqual({
      retarget: { campaign_id: "x", stage: "failed_cap" },
    });
    expect(buildAudienceFilter(aud({ mode: "csv", csvTag: "list:vips-20260929" }))).toEqual({ tags: ["list:vips-20260929"] });
    expect(buildAudienceFilter(aud({ mode: "csv", csvTag: null }))).toEqual({ tags: [UNCHOSEN_AUDIENCE_TAG] });
    expect(buildAudienceFilter(aud({ mode: "everyone" }))).toEqual({});
  });

  it("round-trips through audienceFromFilter", () => {
    const modes: AudienceState[] = [
      aud({ mode: "warm" }),
      aud({ mode: "engaged" }),
      aud({ mode: "segment", segments: ["loyal", "vip"] }),
      aud({ mode: "tags", tagsAny: ["x"], excludeTags: ["y"] }),
      aud({ mode: "retarget", retargetCampaignId: "c1", retargetStage: "read_no_reply" }),
      aud({ mode: "csv", csvTag: "list:a-20260929", csvConsent: true }),
      aud({ mode: "everyone" }),
    ];
    for (const a of modes) {
      const back = audienceFromFilter(buildAudienceFilter(a));
      expect(back.mode).toBe(a.mode);
      expect(filterKey(buildAudienceFilter(back))).toBe(filterKey(buildAudienceFilter(a)));
    }
  });

  it("treats the placeholder draft audience as not chosen", () => {
    expect(audienceFromFilter({ tags: [UNCHOSEN_AUDIENCE_TAG] }).mode).toBe("warm");
    expect(audienceFromFilter(null).mode).toBe("warm");
  });

  it("detects an API that dropped a key (audience would widen)", () => {
    expect(sameFilter({ engagement: "warm" }, {})).toBe(false);
    expect(sameFilter({ tags: ["b", "a"] }, { tags: ["a", "b"] })).toBe(true);
    expect(sameFilter({ tags: [] }, {})).toBe(true);
    expect(sameFilter({ retarget: { campaign_id: "1", stage: "not_read" } }, { retarget: { stage: "not_read", campaign_id: "1" } })).toBe(true);
  });

  it("validates each audience mode", () => {
    expect(audienceProblems(aud({ mode: "segment" }))).toHaveLength(1);
    expect(audienceProblems(aud({ mode: "tags" }))).toHaveLength(1);
    expect(audienceProblems(aud({ mode: "tags", tagsAll: ["x"] }))).toHaveLength(0);
    expect(audienceProblems(aud({ mode: "retarget" }))).toHaveLength(1);
    expect(audienceProblems(aud({ mode: "csv", csvTag: "list:x" }))).toEqual([
      "Confirm that the people on this list agreed to hear from PROMUNCH on WhatsApp.",
    ]);
    expect(audienceProblems(aud({ mode: "warm" }))).toEqual([]);
  });

  it("flags cold audiences", () => {
    expect(isColdAudience("everyone", null)).toBe(true);
    expect(isColdAudience("csv", 0)).toBe(true);
    expect(isColdAudience("warm", 0.9)).toBe(false);
    expect(isColdAudience("tags", 0.6)).toBe(true);
    expect(isColdAudience("tags", 0.3)).toBe(false);
  });
});

describe("estimates", () => {
  it("costs delivered messages only, with GST", () => {
    const e = estimateOutcome(500, "warm");
    expect(e.heldBack).toBe(250);
    expect(e.delivered).toBe(250);
    expect(e.costInr).toBeCloseTo(250 * MARKETING_RATE_INR * (1 + GST_RATE), 1);
  });

  it("is more conservative for cold lists", () => {
    expect(estimateOutcome(100, "everyone").heldBack).toBe(70);
    expect(estimateOutcome(100, "engaged").heldBack).toBe(45);
    expect(estimateOutcome(0, "warm")).toMatchObject({ delivered: 0, costInr: 0 });
  });

  it("paces against the budget left after order and journey messages", () => {
    const start = Date.parse("2026-09-29T05:00:00Z"); // 10:30 IST
    const p = pacing(500, { limit: 250, non_campaign_24h: 50 }, 3, start);
    expect(p.perDay).toBe(200);
    expect(p.days).toBe(3);
    expect(new Date(p.finishMs!).toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(pacing(0, null, null, start)).toMatchObject({ perDay: 0, days: 0 });
    expect(pacing(10, null, null, start).finishMs).toBeNull();
  });
});

describe("template content", () => {
  it("turns template blanks into friendly fields with samples", () => {
    const f = templateFields(tpl());
    expect(f.map((x) => x.key)).toEqual(["1", "2", "_button_0"]);
    expect(initialVars(tpl())).toEqual({ "1": "Priya", "2": "15%", _button_0: "https://promunch.in/collections/all" });
  });

  it("uses one tracked-link field for short-link buttons and a title field for text headers", () => {
    const t = tpl({
      header_type: "TEXT",
      header_text: "Hello {{1}}",
      header_media_url: null,
      header_samples: ["friend"],
      buttons: [
        { type: "URL", text: "Shop", url: "https://crm.promunch.in/r/{{1}}" },
        { type: "URL", text: "More", url: "https://crm.promunch.in/r/{{1}}" },
      ],
    });
    expect(templateFields(t).map((x) => x.key)).toEqual(["_header_1", "1", "2", "_track_url"]);
    expect(initialVars(t)._header_1).toBe("friend");
  });

  it("reports missing values in plain English", () => {
    const p = contentProblems(tpl(), { "1": "{name}", "2": "" }, { mediaUrl: null, ai: false, brief: "", name: "" });
    expect(p.map((x) => x.field)).toEqual(["name", "2"]);
  });

  it("lets AI fill body blanks but requires a brief", () => {
    const vars = { _button_0: "collections/all" };
    expect(contentProblems(tpl(), vars, { mediaUrl: null, ai: true, brief: "", name: "x" }).map((x) => x.field)).toEqual(["brief"]);
    expect(contentProblems(tpl(), vars, { mediaUrl: null, ai: true, brief: "Be warm", name: "x" })).toEqual([]);
  });

  it("needs media for a media header and catches the wrong kind of file", () => {
    const noMedia = tpl({ header_media_url: null });
    const vars = initialVars(tpl());
    expect(contentProblems(noMedia, vars, { mediaUrl: null, ai: false, brief: "", name: "x" }).map((x) => x.field)).toEqual(["media"]);
    const wrong = contentProblems(tpl(), vars, { mediaUrl: "https://cdn.example.com/v.mp4", ai: false, brief: "", name: "x" });
    expect(wrong[0].message).toMatch(/video but this template needs a image/);
  });

  it("rejects non-https tracked links and long dashes", () => {
    const t = tpl({ buttons: [{ type: "URL", text: "Shop", url: "https://crm.promunch.in/r/{{1}}" }] });
    const p = contentProblems(t, { "1": "Hi — there", "2": "x", _track_url: "promunch.in" }, { mediaUrl: null, ai: false, brief: "", name: "x" });
    expect(p.map((x) => x.field).sort()).toEqual(["1", "_track_url"]);
  });

  it("builds the engine payload with only this template's keys", () => {
    expect(buildTemplateVars({ "1": " a ", "2": "", stale: "x" }, true, " brief ", tpl())).toEqual({ "1": "a", _ai_brief: "brief" });
    expect(buildTemplateVars({ "1": "a" }, false, "brief", tpl())).toEqual({ "1": "a" });
  });

  it("fills the preview with the sample name", () => {
    expect(fillText("Hi {{1}}, {{2}} off", { "1": "{name}", "2": "10%" })).toBe("Hi Priya, 10% off");
    expect(fillText("Hi {{1}}", {})).toBe("Hi {{1}}");
    expect(fillText("Big {{1}}", { _header_1: "sale" }, "Priya", true)).toBe("Big sale");
  });

  it("puts marketing templates first", () => {
    const list = sortTemplatesForGallery([
      { name: "b", category: "utility" },
      { name: "z", category: "marketing" },
      { name: "a", category: "marketing" },
    ]);
    expect(list.map((x) => x.name)).toEqual(["a", "z", "b"]);
  });
});

describe("schedule", () => {
  it("reads and writes India time regardless of browser timezone", () => {
    const ms = parseIstInput("2026-09-30T10:00")!;
    expect(new Date(ms).toISOString()).toBe("2026-09-30T04:30:00.000Z");
    expect(toIstInput(ms)).toBe("2026-09-30T10:00");
    expect(parseIstInput("nope")).toBeNull();
  });

  it("validates future times and repeat end", () => {
    const now = Date.parse("2026-09-29T04:30:00Z");
    expect(scheduleProblems({ when: "now", at: "", repeat: "", until: "" }, now)).toEqual([]);
    expect(scheduleProblems({ when: "schedule", at: "", repeat: "", until: "" }, now)).toEqual(["Pick a date and time."]);
    expect(scheduleProblems({ when: "schedule", at: "2026-09-29T09:00", repeat: "", until: "" }, now)).toEqual(["Pick a time in the future."]);
    expect(scheduleProblems({ when: "schedule", at: "2026-09-30T10:00", repeat: "weekly", until: "2026-09-29" }, now)).toHaveLength(1);
    expect(scheduleProblems({ when: "schedule", at: "2026-09-30T10:00", repeat: "weekly", until: "2026-10-30" }, now)).toEqual([]);
  });

  it("moves a quiet-hours start to the morning", () => {
    const now = Date.parse("2026-09-29T17:00:00Z"); // 22:30 IST
    const start = effectiveStart({ when: "now", at: "", repeat: "", until: "" }, now);
    expect(toIstInput(start)).toBe("2026-09-30T10:00");
    const scheduled = effectiveStart({ when: "schedule", at: "2026-09-30T14:00", repeat: "", until: "" }, now);
    expect(toIstInput(scheduled)).toBe("2026-09-30T14:00");
  });

  it("checks the typed audience number", () => {
    expect(typedCountMatches("1,234", 1234)).toBe(true);
    expect(typedCountMatches("123", 1234)).toBe(false);
    expect(typedCountMatches("", 0)).toBe(false);
  });
});

describe("list + actions", () => {
  it("groups ended campaigns under Completed", () => {
    expect(matchesListFilter("cancelled", "completed")).toBe(true);
    expect(matchesListFilter("failed", "completed")).toBe(true);
    expect(matchesListFilter("paused", "sending")).toBe(false);
    expect(matchesListFilter("paused", "all")).toBe(true);
  });

  it("offers only actions that can work", () => {
    expect(allowedActions({ status: "draft", sent_count: 0, failed_count: 0 })).toEqual(["open", "edit", "duplicate", "delete"]);
    expect(allowedActions({ status: "sending", sent_count: 5, failed_count: 0 })).toEqual(["open", "pause", "cancel", "duplicate"]);
    expect(allowedActions({ status: "paused", sent_count: 5, failed_count: 0 })).toEqual(["open", "resume", "cancel", "duplicate"]);
    expect(allowedActions({ status: "completed", sent_count: 5, failed_count: 1 })).toEqual(["open", "duplicate"]);
    expect(allowedActions({ status: "completed", sent_count: 0, failed_count: 0 })).toContain("delete");
  });

  it("explains held and skipped counts", () => {
    const rows = breakdownRows({ cart: 2, governor: 5, ticket: 0 }, "held");
    expect(rows.map((r) => r.key)).toEqual(["governor", "cart"]);
    expect(breakdownRows({ cap_exhausted: 3 }, "skipped")[0].label).toBe("Held back by Meta 3 times");
    expect(breakdownRows(null, "held")).toEqual([]);
  });
});

describe("csv + test numbers", () => {
  it("parses quoted CSV and picks phone/name columns", () => {
    const { headers, rows } = parseCsv('﻿Name,Mobile\r\n"Doe, Jane",98765 43210\nBob,098765-43210\nNo phone,abc\n');
    expect(headers).toEqual(["Name", "Mobile"]);
    const r = csvContacts(headers, rows);
    expect(r.contacts).toEqual([{ phone: "919876543210", name: "Doe, Jane" }]);
    expect(r.skipped).toBe(2); // duplicate + invalid
  });

  it("makes a list tag per upload", () => {
    expect(listTagFor("Diwali VIPs.csv", Date.parse("2026-09-29T20:00:00Z"))).toBe("list:diwali-vips-20260930");
    expect(listTagFor("***")).toMatch(/^list:upload-\d{8}$/);
  });

  it("normalises and remembers test numbers", () => {
    expect(normalizeTestNumber("98765 43210")).toBe("919876543210");
    expect(normalizeTestNumber("+44 7700 900123")).toBe("447700900123");
    expect(normalizeTestNumber("123")).toBeNull();
    expect(rememberNumber(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(rememberNumber(["a", "b", "c"], "d")).toEqual(["d", "a", "b"]);
  });

  it("escapes CSV exports", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], [null, 3]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n,3');
  });
});
