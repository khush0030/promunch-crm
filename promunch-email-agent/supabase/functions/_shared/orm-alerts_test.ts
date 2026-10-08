import { assert, assertEquals } from "jsr:@std/assert";
import { alertKinds, alertMarker, type AlertMention, alertRecipients, buildAlertVars } from "./orm-alerts.ts";

const NOW = Date.parse("2026-10-09T06:00:00Z");
const m = (o: Partial<AlertMention> = {}): AlertMention => ({
  id: "11111111-2222-3333-4444-555555555555",
  source: "amazon",
  relevant: true,
  urgency: "normal",
  rating: 4,
  sentiment: 0,
  is_owned: true,
  author_followers: null,
  author_name: "Neha",
  author_handle: null,
  summary: "Customer found an insect in the pack",
  title: null,
  body: "There was an insect",
  posted_at: "2026-10-08T06:00:00Z",
  collected_at: "2026-10-09T05:00:00Z",
  ...o,
});

Deno.test("rules: critical, low_rating, negative in order", () => {
  assertEquals(alertKinds(m({ urgency: "critical", rating: 1 }), NOW), ["critical", "low_rating"]);
  assertEquals(alertKinds(m({ rating: "2.0" as unknown as number }), NOW), ["low_rating"]);
  assertEquals(alertKinds(m({ rating: 3 }), NOW), []);
  assertEquals(alertKinds(m({ source: "youtube", is_owned: false, rating: null, sentiment: -2, author_followers: 5000 }), NOW), ["negative"]);
  assertEquals(alertKinds(m({ source: "youtube", is_owned: false, rating: null, sentiment: -2, author_followers: 4999 }), NOW), []);
  assertEquals(alertKinds(m({ is_owned: true, rating: null, sentiment: -2, author_followers: 90000 }), NOW), []);
});

Deno.test("rules: irrelevant or older than 7 days never alert", () => {
  assertEquals(alertKinds(m({ urgency: "critical", relevant: false }), NOW), []);
  assertEquals(alertKinds(m({ urgency: "critical", relevant: null }), NOW), []);
  assertEquals(alertKinds(m({ urgency: "critical", posted_at: "2026-10-01T05:59:00Z" }), NOW), []);
  assertEquals(alertKinds(m({ urgency: "critical", posted_at: null, collected_at: "2026-10-09T00:00:00Z" }), NOW), ["critical"]);
});

Deno.test("recipients: settings list wins, else support list; cleaned + de-duped", () => {
  assertEquals(alertRecipients(["+91 98765 43210", "919876543210"], ["911111111111"]), ["919876543210"]);
  assertEquals(alertRecipients([], ["+911111111111", "911111111111", "x"]), ["911111111111"]);
  assertEquals(alertRecipients(null, []), []);
});

Deno.test("marker encodes mention + recipient", () => {
  assertEquals(alertMarker("abc", "919"), "orm_alert:abc:919");
});

Deno.test("alert vars: labels, no em dashes, link, ≤300", () => {
  const v = buildAlertVars(m({ urgency: "critical", rating: 1, sentiment: -2, summary: "Bad — very bad " + "z".repeat(400) }), "critical", "https://crm.example.in/");
  assertEquals(v["1"], "Reputation alert");
  assertEquals(v["2"], "Amazon review");
  assert(v["3"].startsWith("CRITICAL"));
  assert(v["3"].includes("1 of 5 stars"));
  assertEquals(v["4"], "Neha");
  assert(v["5"].length <= 300);
  assert(v["5"].endsWith("https://crm.example.in/dashboard/reputation?m=11111111-2222-3333-4444-555555555555"));
  for (const k of ["1", "2", "3", "4", "5"]) assert(!/[—–]/.test(v[k]), k);
});

Deno.test("alert vars: followers + fallback text", () => {
  const v = buildAlertVars(m({ source: "youtube", author_name: "Snack Reviews", author_followers: 12000, summary: null, title: "Honest review", rating: null, sentiment: -2 }), "negative", "https://crm.example.in");
  assertEquals(v["4"], "Snack Reviews, 12,000 followers");
  assert(v["5"].startsWith("Honest review "));
  assertEquals(v["3"], "very negative");
});
