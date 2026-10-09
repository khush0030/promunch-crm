import { describe, it, expect } from "vitest";
import { parseNewDeal, workDomain } from "./create";

const NOW = new Date("2026-10-09T06:30:00Z");

describe("parseNewDeal", () => {
  it("builds a manual deal with sensible defaults", () => {
    const r = parseNewDeal(
      { company_name: "  Zeta   Foods ", contact_name: "Kabir", contact_email: "Kabir@ZetaFoods.in", value: "₹50,000" },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.row).toMatchObject({
      company_name: "Zeta Foods",
      company_domain: "zetafoods.in",
      kind: "other",
      contact_name: "Kabir",
      contact_email: "kabir@zetafoods.in",
      contact_phone: null,
      stage: "new",
      manual_stage_override: true,
      human_touched_at: NOW.toISOString(),
      value_inr: 50000,
      source: "manual",
      source_ref: null,
    });
    expect(r.value.note).toBeNull();
  });

  it("accepts the Inbox / B2B contract (company, phone, alias kind, source_ref)", () => {
    const r = parseNewDeal(
      {
        company: "Fresh Mart",
        contact_name: "Ravi",
        contact_phone: "98765 43210",
        kind: "wholesale",
        stage: "talking",
        notes: "Wants 200 cartons",
        source: "whatsapp",
        source_ref: "thread-123",
      },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.row.contact_phone).toBe("919876543210");
    expect(r.value.row.kind).toBe("distribution_wholesale");
    expect(r.value.row.stage).toBe("talking");
    expect(r.value.row.source).toBe("whatsapp");
    expect(r.value.row.source_ref).toBe("thread-123");
    expect(r.value.note).toBe("Wants 200 cartons");
  });

  it("maps old stage names and falls back to the contact for the name", () => {
    const r = parseNewDeal({ contact_name: "Asha", stage: "negotiation" }, NOW);
    expect(r.ok && r.value.row.stage).toBe("negotiating");
    expect(r.ok && r.value.row.company_name).toBe("Asha");
  });

  it("keeps a value it cannot read as ₹ in the note", () => {
    const r = parseNewDeal({ company: "X", value: "200 packs a month" }, NOW);
    expect(r.ok && r.value.row.value_inr).toBeNull();
    expect(r.ok && r.value.note).toBe("Value: 200 packs a month");
  });

  it("rejects bad input in plain words", () => {
    expect(parseNewDeal({}, NOW)).toEqual({ ok: false, error: "Add the business name." });
    expect(parseNewDeal({ company: "X", contact_email: "nope" }, NOW)).toEqual({ ok: false, error: "That email doesn't look right." });
    expect(parseNewDeal({ company: "X", contact_phone: "12" }, NOW)).toEqual({ ok: false, error: "That phone number doesn't look right." });
    expect(parseNewDeal({ company: "X", stage: "closed" }, NOW)).toEqual({ ok: false, error: "Pick a stage from the list." });
    expect(parseNewDeal({ company: "X", kind: "spaceship" }, NOW)).toEqual({ ok: false, error: "Pick a type from the list." });
    expect(parseNewDeal({ company: "X", follow_up_at: "2026-02-31" }, NOW)).toEqual({ ok: false, error: "Pick a real follow-up date." });
    expect(parseNewDeal("x", NOW)).toEqual({ ok: false, error: "Send the deal as JSON." });
  });
});

describe("workDomain", () => {
  it("keeps work domains, drops free mail", () => {
    expect(workDomain("a@zetafoods.in")).toBe("zetafoods.in");
    expect(workDomain("a@gmail.com")).toBeNull();
    expect(workDomain(null)).toBeNull();
  });
});
