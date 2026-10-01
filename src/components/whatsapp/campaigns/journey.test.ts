import { describe, expect, it } from "vitest";
import {
  FOLLOWUP_STAGES,
  FOLLOWUP_SUGGESTIONS,
  buildTree,
  delayProblems,
  delayWarning,
  descendantCount,
  draftFromCampaign,
  draftFromSuggestion,
  draftHours,
  duplicateWarnings,
  filterJourneyList,
  flattenTree,
  followupName,
  followupProblems,
  followupRuleSentence,
  followupShortLabel,
  followupStatusMeta,
  formatDelay,
  fromHours,
  hasTrackedLink,
  normalizeVars,
  sameJourneyMessage,
  stageDescription,
  stageDisabledReason,
  stageWho,
  toHours,
} from "./journey";
import { allowedActions, audienceFromFilter, type CampaignTemplate } from "./logic";

const TRACKED = { buttons: [{ type: "URL", text: "Shop", url: "https://promunch.in/r/{{1}}" }] };
const PLAIN_LINK = { buttons: [{ type: "URL", text: "Shop", url: "https://promunch.in/collections/all" }] };

describe("stages", () => {
  it("has a plain description for every stage, no em dashes", () => {
    const keys = FOLLOWUP_STAGES.map((s) => s.key).sort();
    expect(keys).toEqual(["clicked", "delivered", "not_clicked", "not_ordered", "not_read", "ordered", "read", "read_no_reply", "replied"]);
    for (const s of FOLLOWUP_STAGES) {
      expect(stageDescription(s.key).length).toBeGreaterThan(5);
      expect(`${s.who} ${s.description}`).not.toMatch(/—/);
    }
  });

  it("builds the 'people who' phrase", () => {
    expect(stageWho("read")).toBe("people who read it");
    expect(stageWho("not_read")).toBe("people who got it but didn't read it");
    expect(stageWho("ordered")).toBe("people who bought something after getting it");
    expect(stageWho("nope")).toBe("people from the first message");
    expect(stageDescription("nope")).toBe("");
  });

  it("only allows click stages when the parent has a tracked link", () => {
    expect(hasTrackedLink(TRACKED)).toBe(true);
    expect(hasTrackedLink({ buttons: [{ type: "url", url: "https://x.in/r/{{ 1 }}" }] })).toBe(true);
    expect(hasTrackedLink(PLAIN_LINK)).toBe(false);
    expect(hasTrackedLink({ buttons: [{ type: "QUICK_REPLY", url: "/r/{{1}}" }] })).toBe(false);
    expect(hasTrackedLink(null)).toBe(false);
    expect(stageDisabledReason("clicked", PLAIN_LINK)).toMatch(/tracked link/);
    expect(stageDisabledReason("not_clicked", null)).toMatch(/tracked link/);
    expect(stageDisabledReason("clicked", TRACKED)).toBeNull();
    expect(stageDisabledReason("read", null)).toBeNull();
  });
});

describe("delay", () => {
  it("converts and formats", () => {
    expect(toHours(2, "days")).toBe(48);
    expect(toHours(5, "hours")).toBe(5);
    expect(fromHours(48)).toEqual({ amount: 2, unit: "days" });
    expect(fromHours(30)).toEqual({ amount: 30, unit: "hours" });
    expect(fromHours(12)).toEqual({ amount: 12, unit: "hours" });
    expect(formatDelay(48)).toBe("2 days");
    expect(formatDelay(24)).toBe("1 day");
    expect(formatDelay(1)).toBe("1 hour");
    expect(formatDelay(30)).toBe("30 hours");
  });

  it("validates", () => {
    expect(delayProblems("2", "days")).toEqual([]);
    expect(delayProblems(1, "hours")).toEqual([]);
    expect(delayProblems(30, "days")).toEqual([]);
    expect(delayProblems("", "days")[0]).toMatch(/how long/);
    expect(delayProblems("abc", "days")[0]).toMatch(/how long/);
    expect(delayProblems("0", "hours")[0]).toMatch(/whole number/);
    expect(delayProblems("1.5", "days")[0]).toMatch(/whole number/);
    expect(delayProblems("31", "days")[0]).toMatch(/30 days/);
    expect(delayProblems("721", "hours")[0]).toMatch(/30 days/);
  });

  it("warns under 24 hours only", () => {
    expect(delayWarning(5)).toMatch(/next day at the earliest/);
    expect(delayWarning(23)).not.toBeNull();
    expect(delayWarning(24)).toBeNull();
    expect(delayWarning(48)).toBeNull();
  });

  it("reads hours off a draft", () => {
    expect(draftHours({ amount: "2", unit: "days" })).toBe(48);
    expect(draftHours({ amount: "x", unit: "days" })).toBeNull();
  });
});

describe("sentences", () => {
  it("builds the rule sentence", () => {
    expect(followupRuleSentence({ hours: 48, stage: "read", templateName: "Diwali reminder" })).toBe(
      '2 days after each person gets it, people who read it get "Diwali reminder".',
    );
    expect(followupRuleSentence({ hours: 5, stage: "not_read" })).toBe("5 hours after each person gets it, people who got it but didn't read it get the follow-up.");
  });

  it("builds the list label and names", () => {
    expect(followupShortLabel(48, "read")).toBe("Follow-up · after 2 days · people who read it");
    expect(followupName("Diwali", 2)).toBe("Diwali: follow-up 2");
    expect(followupName("  ", 1)).toBe("Campaign: follow-up 1");
  });

  it("has no em dashes in suggestions", () => {
    for (const s of FOLLOWUP_SUGGESTIONS) expect(`${s.title} ${s.hint}`).not.toMatch(/—/);
  });
});

describe("status", () => {
  it("says Waiting for an armed follow-up", () => {
    expect(followupStatusMeta("scheduled").label).toBe("Waiting");
    expect(followupStatusMeta("sending").label).toBe("Sending");
  });
  it("never offers Duplicate on a follow-up", () => {
    expect(allowedActions({ status: "draft", sent_count: 0, failed_count: 0, followup_of: "p" })).not.toContain("duplicate");
    expect(allowedActions({ status: "draft", sent_count: 0, failed_count: 0 })).toContain("duplicate");
  });
  it("copies a follow-up's filter as the safe default audience", () => {
    expect(audienceFromFilter({ retarget: { campaign_id: "p", stage: "read", min_hours_since: 48 } }).mode).toBe("warm");
    expect(audienceFromFilter({ retarget: { campaign_id: "p", stage: "not_read" } }).mode).toBe("retarget");
  });
});

describe("drafts", () => {
  const tpl: CampaignTemplate = {
    id: "t1", name: "reminder", language: "en", category: "MARKETING", status: "APPROVED",
    body: "Hi {{1}}, still thinking about it?", footer: null, header_type: null, header_text: null,
    header_media_url: null, buttons: [], variables: [{ name: "1", sample: "Priya" }],
  } as unknown as CampaignTemplate;

  it("starts from a suggestion", () => {
    const d = draftFromSuggestion({ stage: "not_read", hours: 48 }, "k");
    expect(d).toMatchObject({ key: "k", amount: "2", unit: "days", stage: "not_read", templateId: null });
  });

  it("lists problems in plain words", () => {
    const d = draftFromSuggestion({ stage: "clicked", hours: 48 }, "k");
    const p = followupProblems(d, null, PLAIN_LINK).map((x) => x.field);
    expect(p).toEqual(["stage", "template"]);
    const ok = { ...d, stage: "read" as const, templateId: "t1", vars: { "1": "{name}" } };
    expect(followupProblems(ok, tpl, PLAIN_LINK)).toEqual([]);
    expect(followupProblems({ ...ok, vars: {} }, tpl, null).map((x) => x.field)).toEqual(["1"]);
    expect(followupProblems({ ...ok, amount: "0" }, tpl, null)[0].field).toBe("delay");
  });

  it("round-trips a saved follow-up", () => {
    const d = draftFromCampaign({ id: "c9", followup_after_hours: 72, followup_stage: "ordered", template_id: "t1", template_vars: { "1": "x", _ai_brief: "b" }, header_media_url: null });
    expect(d).toMatchObject({ key: "fu-c9", id: "c9", amount: "3", unit: "days", stage: "ordered", vars: { "1": "x" } });
    const copy = draftFromCampaign({ id: "c9", followup_after_hours: 5, followup_stage: "read", template_id: "t1", template_vars: null, header_media_url: null }, true);
    expect(copy.id).toBeNull();
    expect(copy.key).not.toBe("fu-c9");
    expect(copy).toMatchObject({ amount: "5", unit: "hours" });
  });
});

describe("journey trees", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 8, 30, 10, m)).toISOString();
  const rows = [
    { id: "b", followup_of: null, created_at: at(5), status: "draft" },
    { id: "a", followup_of: null, created_at: at(0), status: "completed" },
    { id: "a2", followup_of: "a", created_at: at(3), status: "scheduled" },
    { id: "a1", followup_of: "a", created_at: at(1), status: "sending" },
    { id: "a1x", followup_of: "a1", created_at: at(4), status: "draft" },
    { id: "orphan", followup_of: "gone", created_at: at(6), status: "draft" },
  ];

  it("nests follow-ups under their parent, oldest first", () => {
    const flat = flattenTree(buildTree(rows)).map((r) => `${r.item.id}:${r.depth}`);
    expect(flat).toEqual(["b:0", "a:0", "a1:1", "a1x:2", "a2:1", "orphan:0"]);
  });

  it("breaks cycles instead of looping", () => {
    const loop = [
      { id: "x", followup_of: "y" },
      { id: "y", followup_of: "x" },
    ];
    const flat = flattenTree(buildTree(loop)).map((r) => r.item.id).sort();
    expect(flat).toEqual(["x", "y"]);
  });

  it("filters but keeps the parents a matching follow-up hangs from", () => {
    const sending = filterJourneyList(rows, (r) => r.status === "sending").map((r) => `${r.item.id}:${r.depth}`);
    expect(sending).toEqual(["a:0", "a1:1"]);
    const drafts = filterJourneyList(rows, (r) => r.status === "draft").map((r) => r.item.id);
    expect(drafts).toEqual(["b", "a", "a1", "a1x", "orphan"]);
    expect(filterJourneyList(rows, () => false)).toEqual([]);
    expect(filterJourneyList(rows, () => true)).toHaveLength(rows.length);
  });

  it("counts follow-ups at every level", () => {
    expect(descendantCount(rows, "a")).toBe(3);
    expect(descendantCount(rows, "a1")).toBe(1);
    expect(descendantCount(rows, "b")).toBe(0);
    expect(descendantCount(rows, "missing")).toBe(0);
  });
});

describe("exact copies", () => {
  it("normalises like the server", () => {
    expect(normalizeVars({ b: " x ", a: "y" })).toBe(normalizeVars({ a: "y", b: "x" }));
    expect(normalizeVars(null)).toBe("{}");
  });
  it("treats an empty picture as the template's own", () => {
    const a = { template_id: "t", template_vars: { "1": "hi" }, header_media_url: null };
    expect(sameJourneyMessage(a, { ...a, header_media_url: "https://x/p.jpg" }, "https://x/p.jpg")).toBe(true);
    expect(sameJourneyMessage(a, { ...a, header_media_url: "https://x/other.jpg" }, "https://x/p.jpg")).toBe(false);
    expect(sameJourneyMessage(a, { ...a, template_id: "u" })).toBe(false);
    expect(sameJourneyMessage(a, { ...a, template_vars: { "1": "hi there" } })).toBe(false);
  });
  it("flags only the later copy, naming what it copies", () => {
    const main = { template_id: "t", template_vars: { "1": "a" } };
    const w = duplicateWarnings(
      main,
      [
        { key: "k1", msg: { template_id: "t", template_vars: { "1": " a " } } },
        { key: "k2", msg: { template_id: "u", template_vars: {} } },
        { key: "k3", msg: { template_id: "u", template_vars: {} } },
        { key: "k4", msg: { template_id: null } },
      ],
      () => null,
    );
    expect(Object.keys(w).sort()).toEqual(["k1", "k3"]);
    expect(w.k1).toMatch(/the main message/);
    expect(w.k3).toMatch(/follow-up 2/);
  });
});
