import { describe, expect, it } from "vitest";
import { validateCompetitors, validateMentionPatch, validateSettingsPatch, withCaseOpened } from "./settings-patch";
import { topAsins } from "./asins";

describe("validateSettingsPatch", () => {
  it("cleans lists and numbers", () => {
    const r = validateSettingsPatch({
      alerts_enabled: true,
      alert_wa_ids: ["98765 43210", "", "919876543210"],
      keywords: [" PROMUNCH ", "promunch", "Pro Munch"],
      exclude_keywords: [],
      amazon_asins: ["b0abc12345", "B0ABC12345"],
      amazon_reviews_per_asin: 20,
      apify_monthly_budget_usd: 4.999,
    });
    expect(r).toEqual({
      ok: true,
      value: {
        settings: {
          alerts_enabled: true,
          alert_wa_ids: ["919876543210"],
          keywords: ["promunch", "pro munch"],
          exclude_keywords: [],
          amazon_asins: ["B0ABC12345"],
          amazon_reviews_per_asin: 20,
          apify_monthly_budget_usd: 5,
        },
        sources: {},
      },
    });
  });
  it("refuses bad values with plain messages", () => {
    expect(validateSettingsPatch({ keywords: [] })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ alert_wa_ids: ["123"] })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ amazon_asins: ["nope"] })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ amazon_reviews_per_asin: 500 })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ apify_monthly_budget_usd: -1 })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({})).toEqual({ ok: false, error: "nothing to update" });
  });
  it("source patches: enable, schedule, per-source config", () => {
    const r = validateSettingsPatch({
      sources: {
        rss: { enabled: true, config: { feeds: [" https://www.google.com/alerts/feeds/1/2 ", "https://www.google.com/alerts/feeds/1/2"] } },
        youtube: { config: { channel_id: "UCabcdefghijklmnopqrstuv" }, every_minutes: 360 },
      },
    });
    expect(r).toEqual({
      ok: true,
      value: {
        settings: {},
        sources: {
          rss: { enabled: true, config: { feeds: ["https://www.google.com/alerts/feeds/1/2"] } },
          youtube: { config: { channel_id: "UCabcdefghijklmnopqrstuv" }, every_minutes: 360 },
        },
      },
    });
    expect(validateSettingsPatch({ sources: { rss: { config: { feeds: ["not a link"] } } } })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ sources: { youtube: { config: { channel_id: "my channel" } } } })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ sources: { twitter: { enabled: true } } })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ sources: { instagram: { enabled: true } } })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ sources: { reddit: { every_minutes: 5 } } })).toMatchObject({ ok: false });
  });
});

describe("validateMentionPatch", () => {
  const NOW = "2026-10-09T06:30:00.000Z";
  it("replied stamps who and when", () => {
    expect(validateMentionPatch({ status: "replied", reply_text: " Thanks! " }, "a@promunch.in", NOW)).toEqual({
      ok: true,
      value: { status: "replied", replied_at: NOW, replied_by: "a@promunch.in", reply_text: "Thanks!", reply_channel: "manual", updated_at: NOW },
    });
  });
  it("blank text clears, bad status refused", () => {
    expect(validateMentionPatch({ note: "  " }, "a", NOW)).toEqual({ ok: true, value: { note: null, updated_at: NOW } });
    expect(validateMentionPatch({ status: "done" }, "a", NOW)).toMatchObject({ ok: false });
    expect(validateMentionPatch({ note: 5 }, "a", NOW)).toMatchObject({ ok: false });
    expect(validateMentionPatch({}, "a", NOW)).toMatchObject({ ok: false });
  });
});

describe("complaint cases (PATCH mention)", () => {
  const NOW = "2026-10-09T06:30:00.000Z";
  it("resolve needs an outcome and stamps case_resolved_at", () => {
    expect(validateMentionPatch({ case_status: "resolved" }, "a", NOW)).toMatchObject({ ok: false });
    expect(validateMentionPatch({ case_status: "resolved", case_outcome: "magic" }, "a", NOW)).toMatchObject({ ok: false });
    expect(validateMentionPatch({ case_status: "resolved", case_outcome: "recovered" }, "a", NOW)).toEqual({
      ok: true,
      value: { case_status: "resolved", case_outcome: "recovered", case_resolved_at: NOW, updated_at: NOW },
    });
  });
  it("reopen clears outcome and resolved time", () => {
    expect(validateMentionPatch({ case_status: "open" }, "a", NOW)).toEqual({
      ok: true,
      value: { case_status: "open", case_outcome: null, case_resolved_at: null, updated_at: NOW },
    });
    expect(validateMentionPatch({ case_status: "in_progress", assignee: "Narendra" }, "a", NOW)).toEqual({
      ok: true,
      value: { assignee: "Narendra", case_status: "in_progress", case_outcome: null, case_resolved_at: null, updated_at: NOW },
    });
  });
  it("null removes the case; outcome alone or a bad status is refused", () => {
    expect(validateMentionPatch({ case_status: null }, "a", NOW)).toEqual({
      ok: true,
      value: { case_status: null, case_outcome: null, case_opened_at: null, case_resolved_at: null, updated_at: NOW },
    });
    expect(validateMentionPatch({ case_outcome: "refund" }, "a", NOW)).toMatchObject({ ok: false });
    expect(validateMentionPatch({ case_status: "closed" }, "a", NOW)).toMatchObject({ ok: false });
  });
  it("copy-and-open reply is recorded as a manual reply", () => {
    expect(validateMentionPatch({ status: "replied", reply_text: "Thanks" }, "a", NOW)).toMatchObject({
      ok: true,
      value: { reply_channel: "manual" },
    });
  });
  it("opening a case for the first time stamps case_opened_at", () => {
    const p = { case_status: "open" };
    expect(withCaseOpened(p, { case_opened_at: null }, NOW)).toEqual({ case_status: "open", case_opened_at: NOW });
    expect(withCaseOpened(p, { case_opened_at: "2026-10-01T00:00:00Z" }, NOW)).toEqual(p);
    expect(withCaseOpened({ note: "x" }, { case_opened_at: null }, NOW)).toEqual({ note: "x" });
  });
});

describe("v2 settings", () => {
  it("digest, spike and auto-case fields", () => {
    expect(
      validateSettingsPatch({
        weekly_digest_enabled: true,
        weekly_digest_dow: 1,
        weekly_digest_hour_ist: 9,
        spike_alerts_enabled: false,
        spike_threshold: 3,
        spike_window_days: 7,
        auto_case_on_negative: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        settings: {
          weekly_digest_enabled: true,
          spike_alerts_enabled: false,
          auto_case_on_negative: true,
          weekly_digest_dow: 1,
          weekly_digest_hour_ist: 9,
          spike_threshold: 3,
          spike_window_days: 7,
        },
        sources: {},
      },
    });
    expect(validateSettingsPatch({ weekly_digest_dow: 7 })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ weekly_digest_hour_ist: 24 })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ spike_threshold: 1 })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ spike_window_days: 31 })).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ auto_case_on_negative: "yes" })).toMatchObject({ ok: false });
  });
  it("competitor list: cleans, skips empty rows, refuses bad ASINs and duplicates", () => {
    expect(
      validateCompetitors([
        { asin: " b0comp0001 ", brand: " Other Brand ", label: "Roasted chana 200g" },
        { asin: "", brand: "", label: "" },
        { asin: "B0COMP0002", brand: "Third", label: "" },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { asin: "B0COMP0001", brand: "Other Brand", label: "Roasted chana 200g" },
        { asin: "B0COMP0002", brand: "Third", label: "Third" },
      ],
    });
    expect(validateCompetitors([{ asin: "nope", brand: "x", label: "" }])).toMatchObject({ ok: false });
    expect(validateCompetitors([{ asin: "B0COMP0001", brand: "", label: "" }])).toMatchObject({ ok: false });
    expect(
      validateCompetitors([
        { asin: "B0COMP0001", brand: "a", label: "" },
        { asin: "b0comp0001", brand: "b", label: "" },
      ]),
    ).toMatchObject({ ok: false });
    expect(validateSettingsPatch({ competitor_asins: [] })).toEqual({ ok: true, value: { settings: { competitor_asins: [] }, sources: {} } });
    expect(validateSettingsPatch({ sources: { competitors: { enabled: true } } })).toEqual({
      ok: true,
      value: { settings: {}, sources: { competitors: { enabled: true } } },
    });
  });
});

describe("topAsins", () => {
  it("sums units per ASIN and keeps the top n", () => {
    const rows = [
      { asin: "B0AAA00001", title: "PROMUNCH Edamame Masala", quantity_ordered: 3 },
      { asin: "b0aaa00001", title: null, quantity_ordered: 2 },
      { asin: "B0BBB00002", title: "PROMUNCH Crunchies", quantity_ordered: 4 },
      { asin: null, title: "x", quantity_ordered: 9 },
      { asin: "B0CCC00003", title: "PROMUNCH Chips", quantity_ordered: 1 },
    ];
    expect(topAsins(rows, 2)).toEqual([
      { asin: "B0AAA00001", title: "PROMUNCH Edamame Masala", units: 5 },
      { asin: "B0BBB00002", title: "PROMUNCH Crunchies", units: 4 },
    ]);
  });
  it("leaves out the sister brand (Vama) sold from the same account", () => {
    const rows = [
      { asin: "B08GJ4RNF6", title: "Vama Soya Mince Granules 250g", quantity_ordered: 468 },
      { asin: "B09D83MH1Q", title: "PROMUNCH Roasted Soya Crunchies, Cheese & Onion", quantity_ordered: 407 },
    ];
    expect(topAsins(rows).map((a) => a.asin)).toEqual(["B09D83MH1Q"]);
  });
});
