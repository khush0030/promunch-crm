// The three Meta failure verdicts that reach a send path look similar in prose
// and mean completely different things. Getting them confused is not
// theoretical: #131050 was briefly wired into the cap strike counter (which
// would have meant retrying someone who switched our marketing off), and the
// live webhook labelled dead numbers "async cap (#131026) — reopened, retry in
// 6h", which is how one unreachable number absorbed 13 sends in 24h.
//
//   #131049  per-recipient marketing fatigue  -> throttle, retry later, strike
//   #131050  recipient switched marketing off -> unsubscribe, never retry
//   #131026  number cannot receive WhatsApp   -> retire the run, never retry
//
// These assert the boundaries are exclusive, in both the code path and the
// text-fallback path.
//
// Run: deno test supabase/functions/_shared/marketing-governor_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isCapError,
  isMarketingOptOutError,
  isUndeliverableError,
} from "./marketing-governor.ts";

const CAP_TEXT = "This message was not delivered to maintain healthy ecosystem engagement.";
const OPTOUT_TEXT = "Unable to deliver the message. This recipient has chosen to stop receiving marketing messages on WhatsApp from your business";
const DEAD_TEXT = "Message undeliverable";

// Exactly one classifier may claim each code.
Deno.test("numeric codes are mutually exclusive", () => {
  const table: Array<[number, boolean, boolean, boolean]> = [
    // code,   cap,   optOut, dead
    [131049, true, false, false],
    [131050, false, true, false],
    [131026, false, false, true],
    [131047, false, false, false], // re-engagement window: none of the three
    [132012, false, false, false], // component mismatch: none of the three
  ];
  for (const [code, cap, optOut, dead] of table) {
    assertEquals(isCapError(code, null), cap, `#${code} cap`);
    assertEquals(isMarketingOptOutError(code, null), optOut, `#${code} optOut`);
    assertEquals(isUndeliverableError(code, null), dead, `#${code} dead`);
    const claims = [cap, optOut, dead].filter(Boolean).length;
    assert(claims <= 1, `#${code} claimed by ${claims} classifiers`);
  }
});

// A parseable code is authoritative in BOTH directions. Meta told us exactly
// what went wrong, so prose that happens to mention another number must not
// override it.
Deno.test("numeric code beats contradictory prose", () => {
  assertEquals(isCapError(131026, CAP_TEXT), false);
  assertEquals(isUndeliverableError(131026, CAP_TEXT), true);
  assertEquals(isCapError(131049, DEAD_TEXT), true);
  assertEquals(isUndeliverableError(131049, DEAD_TEXT), false);
});

// The status webhook often carries prose and no numeric code, so the text
// fallback has to classify correctly on its own.
Deno.test("text fallback classifies each verdict", () => {
  assertEquals(isCapError(undefined, CAP_TEXT), true);
  assertEquals(isMarketingOptOutError(undefined, CAP_TEXT), false);
  assertEquals(isUndeliverableError(undefined, CAP_TEXT), false);

  assertEquals(isCapError(undefined, OPTOUT_TEXT), false);
  assertEquals(isMarketingOptOutError(undefined, OPTOUT_TEXT), true);
  assertEquals(isUndeliverableError(undefined, OPTOUT_TEXT), false);

  assertEquals(isCapError(undefined, DEAD_TEXT), false);
  assertEquals(isMarketingOptOutError(undefined, DEAD_TEXT), false);
  assertEquals(isUndeliverableError(undefined, DEAD_TEXT), true);
});

// Nothing unknown may be claimed. An unrecognised failure must fall through to
// each caller's ordinary retry/permanent-failure handling rather than being
// silently treated as a cap (retry later) or a dead number (retire forever).
Deno.test("unknown failures are claimed by nobody", () => {
  for (const t of ["", "Message failed to send", "Internal server error", "HTTP 500"]) {
    assertEquals(isCapError(undefined, t), false, t);
    assertEquals(isMarketingOptOutError(undefined, t), false, t);
    assertEquals(isUndeliverableError(undefined, t), false, t);
  }
  // A missing code AND missing text must not classify as anything.
  assertEquals(isCapError(undefined, undefined), false);
  assertEquals(isMarketingOptOutError(undefined, undefined), false);
  assertEquals(isUndeliverableError(undefined, undefined), false);
});

// wa-send forwards error_code through JSON, and some callers read it back out
// of jsonb (ai_meta), where a number can arrive as a string.
Deno.test("string codes parse the same as numbers", () => {
  assertEquals(isCapError("131049", null), true);
  assertEquals(isUndeliverableError("131026", null), true);
  assertEquals(isMarketingOptOutError("131050", null), true);
  // null / empty code must fall through to the text, not parse as 0
  assertEquals(isUndeliverableError("", DEAD_TEXT), true);
  assertEquals(isUndeliverableError(null, DEAD_TEXT), true);
});
