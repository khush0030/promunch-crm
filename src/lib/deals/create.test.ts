import { describe, it, expect } from "vitest";
import { parseNewDeal, workDomain } from "./create";

const NOW = new Date("2026-10-09T06:30:00Z");

describe("parseNewDeal", () => {
  it("builds a manual deal with sensible defaults", () => {
    const r = parseNewDeal({ company_name: "  Zeta   Foods ", contact_name: "Kabir", contact_email: "Kabir@ZetaFoods.in", value: "₹50,000 a month" }, NOW);
    expect(r).toEqual({
      ok: true,
      row: {
        company_name: "Zeta Foods",
        company_domain: "zetafoods.in",
        kind: "other",
        contact_name: "Kabir",
        contact_email: "kabir@zetafoods.in",
        stage: "new_inquiry",
        manual_stage_override: true,
        commercials: "₹50,000 a month",
        notes: null,
        next_step: null,
      },
    });
  });

  it("stamps samples_sent_at when created at Samples sent", () => {
    const r = parseNewDeal({ company_name: "Cafe", stage: "samples_sent", kind: "hotel_hospitality" }, NOW);
    expect(r.ok && r.row.samples_sent_at).toBe(NOW.toISOString());
    expect(r.ok && r.row.kind).toBe("hotel_hospitality");
  });

  it("refuses a missing name, a bad email, a made-up stage or type", () => {
    expect(parseNewDeal({}, NOW)).toEqual({ ok: false, error: "Add the business name." });
    expect(parseNewDeal({ company_name: "X", contact_email: "nope" }, NOW).ok).toBe(false);
    expect(parseNewDeal({ company_name: "X", stage: "closed_forever" }, NOW).ok).toBe(false);
    expect(parseNewDeal({ company_name: "X", kind: "pirates" }, NOW).ok).toBe(false);
    expect(parseNewDeal(null, NOW).ok).toBe(false);
  });

  it("keeps notes' line breaks and caps lengths", () => {
    const r = parseNewDeal({ company_name: "X".repeat(300), notes: "a\nb" }, NOW);
    expect(r.ok && r.row.company_name.length).toBe(200);
    expect(r.ok && r.row.notes).toBe("a\nb");
  });
});

describe("workDomain", () => {
  it("ignores free-mail domains", () => {
    expect(workDomain("a@gmail.com")).toBeNull();
    expect(workDomain("a@hotel.co.in")).toBe("hotel.co.in");
    expect(workDomain(null)).toBeNull();
  });
});
