import { describe, expect, it } from "vitest";
import { waSearchOr, igSearchOr, emSearchOr, ilikeContains, ilikeExact, quotePostgrestValue } from "./search";

describe("waSearchOr", () => {
  it("returns null for an empty/whitespace-only query", () => {
    expect(waSearchOr("")).toBeNull();
    expect(waSearchOr("   ")).toBeNull();
  });

  it("builds the four ilike clauses for a plain text query", () => {
    expect(waSearchOr("shilpa")).toBe(
      'wa_id.ilike."%shilpa%",last_message_snippet.ilike."%shilpa%",ticket_subject.ilike."%shilpa%",escalation_reason.ilike."%shilpa%"',
    );
  });

  it("keeps the dots in an email address so it can actually be found", () => {
    // Stripping "." used to turn this into "nisha@gmail com", which matched
    // nothing and reported no error.
    expect(waSearchOr("nisha@gmail.com")).toContain('wa_id.ilike."%nisha@gmail.com%"');
  });

  it("treats % and _ as literal characters, not wildcards", () => {
    // "%" is ILIKE-escaped to "\%", then the PostgREST quoting escapes that
    // backslash again, so the wire value carries "\\%".
    expect(waSearchOr("50%")).toContain(String.raw`wa_id.ilike."%50\\%%"`);
    expect(waSearchOr("a_b")).toContain(String.raw`wa_id.ilike."%a\\_b%"`);
  });

  it("adds an exact ticket_number clause when the query is all digits", () => {
    expect(waSearchOr("9793")).toBe(
      'wa_id.ilike."%9793%",last_message_snippet.ilike."%9793%",ticket_subject.ilike."%9793%",escalation_reason.ilike."%9793%",ticket_number.eq.9793',
    );
  });

  it("strips a leading # before the digits check", () => {
    expect(waSearchOr("#9793")).toBe(
      'wa_id.ilike."%#9793%",last_message_snippet.ilike."%#9793%",ticket_subject.ilike."%#9793%",escalation_reason.ilike."%#9793%",ticket_number.eq.9793',
    );
  });

  it("omits ticket_number when the digits overflow a 32-bit integer", () => {
    // A 10-digit Indian mobile is the most natural thing to search for, and
    // ticket_number is int4: sending it as ticket_number.eq made Postgres
    // fail the whole query with 22003 (out of range), so search 500'd.
    expect(waSearchOr("9599499864")).toBe(
      'wa_id.ilike."%9599499864%",last_message_snippet.ilike."%9599499864%",ticket_subject.ilike."%9599499864%",escalation_reason.ilike."%9599499864%"',
    );
    expect(waSearchOr("2147483647")).toContain("ticket_number.eq.2147483647");
    expect(waSearchOr("2147483648")).not.toContain("ticket_number");
  });

  it("does not add ticket_number for a mixed alphanumeric query", () => {
    expect(waSearchOr("order9793")).toBe(
      'wa_id.ilike."%order9793%",last_message_snippet.ilike."%order9793%",ticket_subject.ilike."%order9793%",escalation_reason.ilike."%order9793%"',
    );
  });

  it("quotes PostgREST-breaking characters instead of stripping them", () => {
    expect(waSearchOr("a,b(c)")).toBe(
      'wa_id.ilike."%a,b(c)%",last_message_snippet.ilike."%a,b(c)%",ticket_subject.ilike."%a,b(c)%",escalation_reason.ilike."%a,b(c)%"',
    );
  });
});

describe("igSearchOr", () => {
  it("returns null for an empty query", () => {
    expect(igSearchOr("")).toBeNull();
  });

  it("builds the handle/full_name/snippet clauses", () => {
    expect(igSearchOr("priya")).toBe(
      'handle.ilike."%priya%",full_name.ilike."%priya%",last_message_snippet.ilike."%priya%"',
    );
  });
});

describe("emSearchOr", () => {
  it("returns null for an empty query", () => {
    expect(emSearchOr("")).toBeNull();
  });

  it("builds the from_email/from_name/subject clauses", () => {
    expect(emSearchOr("rohan")).toBe(
      'from_email.ilike."%rohan%",from_name.ilike."%rohan%",subject.ilike."%rohan%"',
    );
  });

  it("finds a sender by full email address", () => {
    expect(emSearchOr("nishaagg1994@gmail.com")).toContain('from_email.ilike."%nishaagg1994@gmail.com%"');
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

describe("ilikeContains", () => {
  it("returns null for empty or whitespace-only input", () => {
    expect(ilikeContains("")).toBeNull();
    expect(ilikeContains("   ")).toBeNull();
  });

  it("wraps in wildcards and quotes the value", () => {
    expect(ilikeContains("nisha")).toBe('"%nisha%"');
  });

  it("escapes ILIKE metacharacters and embedded quotes", () => {
    expect(ilikeContains("50%")).toBe(String.raw`"%50\\%%"`);
    expect(ilikeContains('say "hi"')).toBe(String.raw`"%say \"hi\"%"`);
  });
});
