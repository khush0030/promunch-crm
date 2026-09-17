import { describe, expect, it } from "vitest";
import { waSearchOr, igSearchOr, emSearchOr } from "./search";

describe("waSearchOr", () => {
  it("returns null for an empty/whitespace-only query", () => {
    expect(waSearchOr("")).toBeNull();
    expect(waSearchOr("   ")).toBeNull();
  });

  it("builds the four ilike clauses for a plain text query", () => {
    expect(waSearchOr("shilpa")).toBe(
      "wa_id.ilike.%shilpa%,last_message_snippet.ilike.%shilpa%,ticket_subject.ilike.%shilpa%,escalation_reason.ilike.%shilpa%",
    );
  });

  it("adds an exact ticket_number clause when the query is all digits", () => {
    expect(waSearchOr("9793")).toBe(
      "wa_id.ilike.%9793%,last_message_snippet.ilike.%9793%,ticket_subject.ilike.%9793%,escalation_reason.ilike.%9793%,ticket_number.eq.9793",
    );
  });

  it("strips a leading # before the digits check", () => {
    expect(waSearchOr("#9793")).toBe(
      "wa_id.ilike.%#9793%,last_message_snippet.ilike.%#9793%,ticket_subject.ilike.%#9793%,escalation_reason.ilike.%#9793%,ticket_number.eq.9793",
    );
  });

  it("does not add ticket_number for a mixed alphanumeric query", () => {
    expect(waSearchOr("order9793")).toBe(
      "wa_id.ilike.%order9793%,last_message_snippet.ilike.%order9793%,ticket_subject.ilike.%order9793%,escalation_reason.ilike.%order9793%",
    );
  });

  it("sanitizes PostgREST-breaking characters before building clauses", () => {
    expect(waSearchOr("a,b(c)")).toBe(
      "wa_id.ilike.%a b c%,last_message_snippet.ilike.%a b c%,ticket_subject.ilike.%a b c%,escalation_reason.ilike.%a b c%",
    );
  });
});

describe("igSearchOr", () => {
  it("returns null for an empty query", () => {
    expect(igSearchOr("")).toBeNull();
  });

  it("builds the handle/full_name/snippet clauses", () => {
    expect(igSearchOr("priya")).toBe(
      "handle.ilike.%priya%,full_name.ilike.%priya%,last_message_snippet.ilike.%priya%",
    );
  });
});

describe("emSearchOr", () => {
  it("returns null for an empty query", () => {
    expect(emSearchOr("")).toBeNull();
  });

  it("builds the from_email/from_name/subject clauses", () => {
    expect(emSearchOr("rohan")).toBe(
      "from_email.ilike.%rohan%,from_name.ilike.%rohan%,subject.ilike.%rohan%",
    );
  });
});
