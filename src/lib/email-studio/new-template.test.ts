import { describe, it, expect } from "vitest";
import { newTemplateBody } from "./new-template";

const STARTS = ["blank", "sale", "newsletter"];

describe("newTemplateBody", () => {
  it("names a copy of the chosen starting point", () => {
    expect(newTemplateBody("  Festive   drop ", "sale", STARTS)).toEqual({
      ok: true,
      body: { name: "Festive drop", fromSystem: "sale", category: "custom" },
    });
  });
  it("falls back to blank for an unknown start", () => {
    const r = newTemplateBody("X", "made-up", STARTS);
    expect(r.ok && r.body.fromSystem).toBe("blank");
  });
  it("needs a name and caps its length", () => {
    expect(newTemplateBody("   ", "blank", STARTS)).toEqual({ ok: false, error: "Give the template a name." });
    const r = newTemplateBody("n".repeat(200), "blank", STARTS);
    expect(r.ok && r.body.name.length).toBe(120);
  });
});
