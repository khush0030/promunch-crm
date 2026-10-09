import { describe, it, expect } from "vitest";
import { followUpState, formatRupees, initialsOf, normalizeDeal, normalizePhone, parseKind, parseRupees } from "./model";
import { nextStage, normalizeStage, toLegacyStage } from "./stages";
import { parseDealPatch } from "./patch";
import { toLegacyRow, isSchemaLag } from "./legacy";

const TODAY = "2026-10-10";
const NOW = new Date("2026-10-10T05:00:00Z");

const base = (over: Record<string, unknown> = {}) =>
  normalizeDeal(
    {
      id: "d1",
      company_name: "Fresh Mart",
      kind: "distribution_wholesale",
      stage: "in_discussion",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      ...over,
    },
    TODAY,
  );

describe("stages", () => {
  it("maps every old stage to the new names", () => {
    expect(normalizeStage("new_inquiry")).toBe("new");
    expect(normalizeStage("in_discussion")).toBe("talking");
    expect(normalizeStage("samples_requested")).toBe("samples");
    expect(normalizeStage("samples_sent")).toBe("samples");
    expect(normalizeStage("negotiation")).toBe("negotiating");
    expect(normalizeStage("dormant")).toBe("on_hold");
    expect(normalizeStage("won")).toBe("won");
    expect(normalizeStage("bogus")).toBeNull();
    expect(toLegacyStage("on_hold")).toBe("dormant");
  });
  it("next stage walks the board and stops at Won", () => {
    expect(nextStage("new")).toBe("talking");
    expect(nextStage("negotiating")).toBe("won");
    expect(nextStage("won")).toBeNull();
    expect(nextStage("lost")).toBeNull();
  });
});

describe("normalizeDeal + follow-ups", () => {
  it("normalizes an old row", () => {
    const d = base();
    expect(d.stage).toBe("talking");
    expect(d.source).toBe("manual");
    expect(d.value_inr).toBeNull();
    expect(d.follow_up_needed).toBe(false);
  });
  it("a past follow-up date is overdue, today is due, future is later", () => {
    expect(followUpState({ follow_up_at: "2026-10-09", stage: "talking" }, TODAY).state).toBe("overdue");
    expect(followUpState({ follow_up_at: TODAY, stage: "talking" }, TODAY).state).toBe("today");
    expect(followUpState({ follow_up_at: "2026-10-14", stage: "talking" }, TODAY).label).toBe("Follow up 14 Oct");
    expect(followUpState({ follow_up_at: null, stage: "talking", follow_up_flag: true }, TODAY).state).toBe("today");
    expect(followUpState({ follow_up_at: "2026-10-01", stage: "won" }, TODAY).state).toBe("none");
    expect(base({ follow_up_at: "2026-10-09" }).follow_up_needed).toBe(true);
  });
});

describe("money, phone, names", () => {
  it("reads rupees the way people type them", () => {
    expect(parseRupees("₹50,000")).toBe(50000);
    expect(parseRupees("1.5L")).toBe(150000);
    expect(parseRupees("2 lakh")).toBe(200000);
    expect(parseRupees("40k")).toBe(40000);
    expect(parseRupees("Rs. 1200")).toBe(1200);
    expect(parseRupees("lots")).toBeNull();
    expect(formatRupees(8500)).toBe("₹8,500");
    expect(formatRupees(150000)).toBe("₹1.5L");
    expect(formatRupees(25000000)).toBe("₹2.5Cr");
  });
  it("normalizes Indian phones", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("919876543210");
    expect(normalizePhone("09876543210")).toBe("919876543210");
    expect(normalizePhone("123")).toBeNull();
  });
  it("kind aliases and initials", () => {
    expect(parseKind("partnership")).toBe("brand_partnership");
    expect(parseKind("HoReCa")).toBe("hotel_hospitality");
    expect(initialsOf("Priya Shah")).toBe("PS");
    expect(initialsOf("parth.mutha@x.com")).toBe("PM");
  });
});

describe("parseDealPatch", () => {
  it("closing as lost needs a reason and logs the move", () => {
    const cur = base();
    expect(parseDealPatch({ stage: "lost" }, cur, NOW)).toEqual({ ok: false, error: "Add a short reason for Lost." });
    const r = parseDealPatch({ stage: "lost", reason: "Price too high" }, cur, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.patch).toMatchObject({
      stage: "lost",
      closed_reason: "Price too high",
      manual_stage_override: true,
      human_touched_at: NOW.toISOString(),
    });
    expect(r.value.activities[0].body).toBe("Moved from Talking to Lost: Price too high");
  });
  it("Done clears the step and follow-up and logs it", () => {
    const cur = base({ next_step: "Send quote", follow_up_at: "2026-10-09", follow_up_needed: true });
    const r = parseDealPatch({ done: true }, cur, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.patch).toMatchObject({ next_step: null, follow_up_at: null, follow_up_needed: false, human_touched_at: NOW.toISOString() });
    expect(r.value.activities).toEqual([{ kind: "system", body: "Done: Send quote" }]);
  });
  it("contact edits do not count as a human follow-up decision", () => {
    const r = parseDealPatch({ contact_phone: "9876543210", value_inr: "2L" }, base(), NOW);
    expect(r.ok && r.value.patch).toEqual({ contact_phone: "919876543210", value_inr: 200000 });
  });
  it("rejects nonsense", () => {
    expect(parseDealPatch({}, base(), NOW).ok).toBe(false);
    expect(parseDealPatch({ value_inr: "lots" }, base(), NOW).ok).toBe(false);
    expect(parseDealPatch({ follow_up_at: "tomorrow" }, base(), NOW).ok).toBe(false);
  });
});

describe("pre-migration fallback", () => {
  it("strips new columns, maps the stage back, keeps facts in notes", () => {
    const row = toLegacyRow({ stage: "on_hold", contact_phone: "919876543210", value_inr: 50000, follow_up_at: "2026-10-12", closed_reason: "Busy" }, "Old note");
    expect(row.stage).toBe("dormant");
    expect(row).not.toHaveProperty("contact_phone");
    expect(row).not.toHaveProperty("value_inr");
    expect(row.follow_up_needed).toBe(true);
    expect(String(row.notes)).toContain("Old note");
    expect(String(row.notes)).toContain("Phone +91 98765 43210");
    expect(String(row.notes)).toContain("Reason: Busy");
  });
  it("recognises schema lag errors", () => {
    expect(isSchemaLag({ code: "PGRST204", message: "Could not find the 'value_inr' column" })).toBe(true);
    expect(isSchemaLag({ code: "23514", message: 'violates check constraint "deals_stage_check"' })).toBe(true);
    expect(isSchemaLag({ code: "23505", message: "duplicate key" })).toBe(false);
  });
});
