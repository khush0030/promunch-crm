import { describe, expect, it } from "vitest";
import { REJECTION_REASONS, explainRejection, explainTemplateError } from "./template-errors";

describe("explainRejection", () => {
  it("maps known reason codes", () => {
    for (const code of ["INVALID_FORMAT", "TAG_CONTENT_MISMATCH", "INCORRECT_CATEGORY", "ABUSIVE_CONTENT", "SCAM", "PROMOTIONAL", "NONE"]) {
      const r = explainRejection(code);
      expect(r.known).toBe(true);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.howToFix.length).toBeGreaterThan(0);
    }
  });
  it("is case-insensitive and keeps the raw code for details", () => {
    const r = explainRejection("tag_content_mismatch", "Content does not match category");
    expect(r.title).toBe(REJECTION_REASONS.TAG_CONTENT_MISMATCH.title);
    expect(r.raw).toBe("TAG_CONTENT_MISMATCH: Content does not match category");
  });
  it("falls back helpfully for unknown codes", () => {
    const r = explainRejection("SOMETHING_NEW", "details here");
    expect(r.known).toBe(false);
    expect(r.explanation).toContain("details here");
    expect(r.raw).toContain("SOMETHING_NEW");
  });
  it("copy has no em dashes and no raw codes in the visible text", () => {
    for (const e of Object.values(REJECTION_REASONS)) {
      for (const s of [e.title, e.explanation, e.howToFix]) {
        expect(s).not.toMatch(/—/);
        expect(s).not.toMatch(/[A-Z]+_[A-Z]+/);
      }
    }
  });
});

describe("explainTemplateError", () => {
  it("recognises a duplicate name by subcode", () => {
    const r = explainTemplateError({ code: 100, error_subcode: 2388024, message: "Invalid parameter" });
    expect(r.title).toMatch(/already taken/);
    expect(r.known).toBe(true);
  });
  it("recognises a duplicate name from flattened edge-function error text", () => {
    const r = explainTemplateError("Invalid parameter | Message template already exists | subcode 2388024");
    expect(r.title).toMatch(/already taken/);
  });
  it("recognises a recently deleted name", () => {
    expect(explainTemplateError({ error_subcode: 2388023 }).title).toMatch(/deleted recently/);
  });
  it("recognises edit limits and category changes from text", () => {
    expect(explainTemplateError("You can only edit a template once in 24 hours").title).toMatch(/Edit limit/);
    expect(explainTemplateError("Category cannot be changed for approved templates").title).toMatch(/Category cannot change/);
  });
  it("recognises variable problems", () => {
    expect(explainTemplateError("Variables can't be at the start or end of the template").title).toMatch(/start or end/);
    expect(explainTemplateError("The parameter format is invalid").title).toMatch(/numbering/);
  });
  it("maps broad codes", () => {
    expect(explainTemplateError({ code: 368, message: "" }).title).toMatch(/blocked/);
    expect(explainTemplateError("(#190) Error validating access token").title).toMatch(/connection expired/);
    expect(explainTemplateError({ code: 100, message: "Invalid parameter" }).title).toMatch(/did not accept one of the values/);
  });
  it("unknown errors are generic but keep the raw text", () => {
    const r = explainTemplateError("xyzzy happened");
    expect(r.known).toBe(false);
    expect(r.raw).toBe("xyzzy happened");
    expect(explainTemplateError(null).raw).toBeNull();
  });
});
