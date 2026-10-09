import { describe, expect, it } from "vitest";
import { isMissingTable } from "./ig-off";

describe("isMissingTable", () => {
  it("spots PostgREST and Postgres missing-table errors", () => {
    expect(isMissingTable({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isMissingTable({ code: "42P01", message: "x" })).toBe(true);
    expect(isMissingTable({ message: "Could not find the table 'public.ig_prospects' in the schema cache" })).toBe(true);
  });
  it("leaves real errors alone", () => {
    expect(isMissingTable({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});
