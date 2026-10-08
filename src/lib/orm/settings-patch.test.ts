import { describe, expect, it } from "vitest";
import { validateMentionPatch, validateSettingsPatch } from "./settings-patch";
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
      value: { status: "replied", replied_at: NOW, replied_by: "a@promunch.in", reply_text: "Thanks!", updated_at: NOW },
    });
  });
  it("blank text clears, bad status refused", () => {
    expect(validateMentionPatch({ note: "  " }, "a", NOW)).toEqual({ ok: true, value: { note: null, updated_at: NOW } });
    expect(validateMentionPatch({ status: "done" }, "a", NOW)).toMatchObject({ ok: false });
    expect(validateMentionPatch({ note: 5 }, "a", NOW)).toMatchObject({ ok: false });
    expect(validateMentionPatch({}, "a", NOW)).toMatchObject({ ok: false });
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
