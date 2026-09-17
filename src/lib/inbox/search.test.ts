import { describe, expect, it } from "vitest";
import { waSearchOr, igSearchOr, emSearchOr, ilikeExact, quotePostgrestValue } from "./search";

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

describe("quotePostgrestValue", () => {
  it("wraps a plain value in double quotes", () => {
    expect(quotePostgrestValue("kmutha@vippysoya.com")).toBe('"kmutha@vippysoya.com"');
  });

  it("escapes an embedded backslash and double-quote", () => {
    expect(quotePostgrestValue('a\\b"c')).toBe('"a\\\\b\\"c"');
  });

  it("wraps an ISO timestamp (colons and a `+` are not PostgREST-special once quoted)", () => {
    expect(quotePostgrestValue("2026-09-17T02:22:35.743+00:00")).toBe('"2026-09-17T02:22:35.743+00:00"');
  });
});

describe("ilikeExact", () => {
  // The regression this guards: sanitizeSearch (built for *free-text*
  // search, where stripping PostgREST syntax characters from an already-lossy
  // query is fine) strips "." — which corrupts every email address and made
  // filter=mine silently match nothing. ilikeExact must NOT touch ".", "@",
  // or any other character that isn't an ILIKE/PostgREST metacharacter.
  it("passes a plain email through unchanged except for the quotes", () => {
    expect(ilikeExact("kmutha@vippysoya.com")).toBe('"kmutha@vippysoya.com"');
  });

  it("escapes an ILIKE wildcard underscore so it matches literally, then quotes", () => {
    // Step 1 (ILIKE-escape "_" → "\_") then step 2 (quote, which re-escapes
    // that backslash) — verified against a hand-run reference implementation,
    // see the report for the derivation.
    expect(ilikeExact("k_mutha@vippysoya.com")).toBe('"k\\\\_mutha@vippysoya.com"');
  });

  it("escapes a literal % the same way", () => {
    expect(ilikeExact("100%_done")).toBe('"100\\\\%\\\\_done"');
  });

  it("two different underscore-containing emails never collapse to the same clause value (no accidental wildcard match)", () => {
    expect(ilikeExact("a_b@x.com")).not.toBe(ilikeExact("axb@x.com"));
  });
});
