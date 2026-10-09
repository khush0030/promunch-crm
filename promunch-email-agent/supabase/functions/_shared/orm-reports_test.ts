import { assert, assertEquals } from "jsr:@std/assert";
import {
  buildDigestVars,
  buildSpikeVars,
  type DigestMention,
  digestDue,
  digestMarker,
  digestPeriods,
  istDayStart,
  istDow,
  istIsoWeek,
  spikeGroups,
  spikeKey,
  spikeLine,
  type SpikeMention,
  spikeMarker,
  spikeWindowStart,
  summariseDigest,
  topComplaintTopic,
  worstProduct,
} from "./orm-reports.ts";

const noDash = (o: Record<string, string>) => {
  for (const [k, v] of Object.entries(o)) {
    assert(!/[—–]/.test(v), `em dash in ${k}`);
    assert(v.length <= 300, `${k} too long (${v.length})`);
  }
};

Deno.test("IST week key: ISO weeks in IST, boundary at IST midnight", () => {
  // Mon 5 Oct 2026 00:10 IST = Sun 4 Oct 18:40 UTC → IST week 41
  assertEquals(istIsoWeek(Date.parse("2026-10-04T18:40:00Z")), "2026-W41");
  // Sun 4 Oct 2026 23:50 IST → still week 40
  assertEquals(istIsoWeek(Date.parse("2026-10-04T18:20:00Z")), "2026-W40");
  // year edges: Thu 1 Jan 2026 → W01; Sun 3 Jan 2027 → 2026-W53; Mon 4 Jan 2027 → 2027-W01
  assertEquals(istIsoWeek(Date.parse("2026-01-01T06:00:00Z")), "2026-W01");
  assertEquals(istIsoWeek(Date.parse("2027-01-03T06:00:00Z")), "2026-W53");
  assertEquals(istIsoWeek(Date.parse("2027-01-04T06:00:00Z")), "2027-W01");
  // Mon 29 Dec 2025 belongs to 2026-W01
  assertEquals(istIsoWeek(Date.parse("2025-12-29T06:00:00Z")), "2026-W01");
});

Deno.test("IST day start, weekday, digest due gate", () => {
  const t = Date.parse("2026-10-05T04:00:00Z"); // Mon 09:30 IST
  assertEquals(new Date(istDayStart(t)).toISOString(), "2026-10-04T18:30:00.000Z");
  assertEquals(istDow(t), 1);
  const s = { alert_wa_ids: [], weekly_digest_enabled: true, weekly_digest_dow: 1, weekly_digest_hour_ist: 9 };
  assertEquals(digestDue(s, t), true);
  assertEquals(digestDue(s, Date.parse("2026-10-05T03:00:00Z")), false); // 08:30 IST
  assertEquals(digestDue(s, Date.parse("2026-10-06T04:00:00Z")), false); // Tuesday
  assertEquals(digestDue({ ...s, weekly_digest_enabled: false }, t), false);
  assertEquals(digestDue({ alert_wa_ids: [] }, t), false); // column missing = off
});

Deno.test("digest periods are the 7 full IST days before today and the 7 before", () => {
  const p = digestPeriods(Date.parse("2026-10-05T04:00:00Z"));
  assertEquals(new Date(p.cur.from).toISOString(), "2026-09-27T18:30:00.000Z"); // Mon 28 Sep IST
  assertEquals(new Date(p.cur.to).toISOString(), "2026-10-04T18:30:00.000Z");
  assertEquals(p.prev.to, p.cur.from);
});

const mk = (o: Partial<DigestMention>): DigestMention => ({
  rating: null, sentiment: 0, status: "new", case_status: null, urgency: "normal", relevant: true,
  enriched_at: "2026-10-01T00:00:00Z", product: null, topics: [], posted_at: "2026-10-01T06:00:00Z", collected_at: null, ...o,
});

Deno.test("worst product + top complaint", () => {
  const ms = [
    mk({ product: "Masala Mania", rating: 2, sentiment: -1, topics: ["taste", "other"] }),
    mk({ product: "Masala Mania", rating: 5, sentiment: 2 }),
    mk({ product: "Himalayan Rock Salt", rating: 4, sentiment: 1 }),
    mk({ product: null, rating: 1, sentiment: -2, topics: ["delivery", "other"] }),
    mk({ product: "Himalayan Rock Salt", rating: 3, sentiment: -1, topics: ["taste"] }),
    mk({ product: "Indori Chatka", rating: 1, sentiment: 0 }),
  ];
  // both named products are 50% negative → lower avg wins (Rock Salt 3.5 vs Masala 3.5 → name)
  assertEquals(worstProduct(ms)?.product, "Himalayan Rock Salt");
  assertEquals(worstProduct([mk({ product: "A", rating: 4 }), mk({ product: "B", rating: 2 })])?.product, "B");
  assertEquals(worstProduct([mk({ product: null, sentiment: -2 })]), null);
  assertEquals(topComplaintTopic(ms), "taste");
  assertEquals(topComplaintTopic([mk({ sentiment: -1, topics: ["other"] })]), "other");
  assertEquals(topComplaintTopic([mk({ sentiment: 1, topics: ["taste"] })]), null);
});

Deno.test("digest summary + vars", () => {
  const now = Date.parse("2026-10-05T04:00:00Z"); // Mon 09:30 IST; cur = 28 Sep..4 Oct
  const rows = [
    mk({ product: "Masala Mania", rating: 2, sentiment: -1, topics: ["foreign_object"], posted_at: "2026-10-01T06:00:00Z" }),
    mk({ product: "Masala Mania", rating: 5, sentiment: 2, posted_at: "2026-10-02T06:00:00Z" }),
    mk({ product: "Rock Salt", rating: 4, sentiment: 1, posted_at: null, collected_at: "2026-09-30T06:00:00Z" }),
    mk({ rating: 5, sentiment: 2, posted_at: "2026-09-22T06:00:00Z" }), // prev week
    mk({ rating: 5, sentiment: 2, posted_at: "2026-10-05T01:00:00Z" }), // today, excluded
  ];
  const s = summariseDigest(rows, now, 4);
  assertEquals(s.mentions, 3);
  assertEquals(s.score_prev, 100);
  assertEquals(s.avg_rating, 3.67);
  assertEquals(s.pct_negative, 33);
  assertEquals(s.worst, { product: "Masala Mania", avg_rating: 3.5 });
  assertEquals(s.top_complaint, "foreign_object");
  // rating 66.67*.4 + net 66.67*.3 + reply 0*.2 + crit 100*.1 = 26.67+20+0+10 = 56.67 → 57
  assertEquals(s.score, 57);

  const v = buildDigestVars(s, "https://crm.example.in/");
  assertEquals(v["1"], "PROMUNCH reputation, week of 28 Sep");
  assertEquals(v["2"], "Score 57 (Needs work), -43 vs last week");
  assertEquals(v["3"], "3 mentions · 3.7★ · 33% negative");
  assertEquals(v["4"], "Worst: Masala Mania 3.5★");
  assertEquals(v["5"], "Top complaint: foreign object. Open cases: 4. https://crm.example.in/dashboard/reputation?tab=overview");
  noDash(v);
});

Deno.test("digest vars: no previous score, no ratings, long product capped, dashes cleaned", () => {
  const v = buildDigestVars({
    week_start: Date.parse("2026-09-27T18:30:00Z"), mentions: 1, score: 90, score_prev: null, avg_rating: null,
    pct_negative: 0, worst: { product: "Edamame — " + "x".repeat(400), avg_rating: null }, top_complaint: null, open_cases: 0,
  }, "https://crm.example.in");
  assertEquals(v["2"], "Score 90 (Excellent), no score last week");
  assertEquals(v["3"], "1 mention · no ratings · 0% negative");
  assert(v["4"].startsWith("Worst: Edamame ,"));
  assertEquals(v["5"], "Top complaint: none. Open cases: 0. https://crm.example.in/dashboard/reputation?tab=overview");
  noDash(v);
  const same = buildDigestVars({
    week_start: 0, mentions: 2, score: 70, score_prev: 70, avg_rating: 4, pct_negative: 0, worst: null, top_complaint: "customer_service", open_cases: 1,
  }, "https://x.in");
  assertEquals(same["2"], "Score 70 (Good), same as last week");
  assertEquals(same["4"], "Worst: no product data yet");
  assert(same["5"].startsWith("Top complaint: customer service."));
});

Deno.test("markers", () => {
  assertEquals(digestMarker("2026-W41", "919"), "orm_digest:2026-W41:919");
  assertEquals(spikeMarker("masala mania|taste|2026-10-01", "919"), "orm_spike:masala mania|taste|2026-10-01:919");
});

Deno.test("spike window start floors IST days to the window", () => {
  const t = Date.parse("2026-10-09T06:00:00Z");
  assertEquals(spikeWindowStart(t, 1), "2026-10-09");
  // 7-day buckets aligned to the epoch: same bucket for the whole week
  const a = spikeWindowStart(t, 7);
  assertEquals(spikeWindowStart(Date.parse(`${a}T00:00:00Z`) - 330 * 60_000, 7), a); // bucket's first IST minute
  assertEquals(spikeWindowStart(Date.parse(`${a}T00:00:00Z`) - 330 * 60_000 - 60_000, 7) < a, true);
  // IST midnight crossing
  assertEquals(spikeWindowStart(Date.parse("2026-10-08T18:29:00Z"), 1), "2026-10-08");
  assertEquals(spikeWindowStart(Date.parse("2026-10-08T18:30:00Z"), 1), "2026-10-09");
  assertEquals(spikeKey("Masala Mania ", "taste", "2026-10-09"), "masala mania|taste|2026-10-09");
  assertEquals(spikeKey(null, "delivery", "2026-10-09"), "-|delivery|2026-10-09");
});

const sm = (id: string, o: Partial<SpikeMention> = {}): SpikeMention => ({
  id, product: "Masala Mania", topics: ["taste"], sentiment: -1, relevant: true, posted_at: "2026-10-07T06:00:00Z", collected_at: null, ...o,
});

Deno.test("spike grouping: threshold, window, topics, case-insensitive product", () => {
  const now = Date.parse("2026-10-09T06:00:00Z");
  const ms = [
    sm("a"), sm("b", { product: "masala mania" }), sm("c", { topics: ["taste", "taste", "packaging"] }),
    sm("d", { topics: ["packaging"] }),
    sm("e", { sentiment: 1 }), // positive, ignored
    sm("f", { posted_at: "2026-09-25T06:00:00Z" }), // outside 7 days
    sm("g", { relevant: false }),
    sm("h", { product: null, topics: ["delivery", "other"] }), sm("i", { product: " ", topics: ["delivery"] }),
    sm("j", { topics: ["other"] }), sm("k", { topics: ["other"] }), sm("l", { topics: ["other"] }),
  ];
  const ws = spikeWindowStart(now, 7);
  const g = spikeGroups(ms, { now, windowDays: 7, threshold: 3 });
  assertEquals(g.length, 1);
  assertEquals(g[0], { key: `masala mania|taste|${ws}`, product: "Masala Mania", topic: "taste", count: 3, mention_ids: ["a", "b", "c"] });
  const g2 = spikeGroups(ms, { now, windowDays: 7, threshold: 2 });
  assertEquals(g2.map((x) => [x.key, x.count]), [
    [`masala mania|taste|${ws}`, 3],
    [`-|delivery|${ws}`, 2],
    [`masala mania|packaging|${ws}`, 2],
  ]);
  assertEquals(g2[1].product, null);
});

Deno.test("spike grouping: already logged key or same mention set never re-alerts", () => {
  const now = Date.parse("2026-10-09T06:00:00Z");
  const ms = [sm("a"), sm("b"), sm("c")];
  const ws = spikeWindowStart(now, 7);
  const prior = [{ key: `masala mania|taste|${ws}`, product: "Masala Mania", topic: "taste", mention_ids: ["a"] }];
  assertEquals(spikeGroups(ms, { now, windowDays: 7, threshold: 3 }, prior), []);
  // previous window logged a, b, c → same set in a new bucket stays quiet
  const old = [{ key: "masala mania|taste|2000-01-01", product: "MASALA MANIA", topic: "taste", mention_ids: ["a", "b", "c"] }];
  assertEquals(spikeGroups(ms, { now, windowDays: 7, threshold: 3 }, old), []);
  // a new complaint joins → alert again
  assertEquals(spikeGroups([...ms, sm("d")], { now, windowDays: 7, threshold: 3 }, old).length, 1);
});

Deno.test("spike text + vars", () => {
  const g = { key: "k", product: "Masala Mania", topic: "foreign_object", count: 4, mention_ids: [] };
  assertEquals(spikeLine(g, 7), "Possible batch issue: 4 complaints about foreign object on Masala Mania in 7 days");
  assertEquals(spikeLine({ ...g, product: null }, 1), "Possible batch issue: 4 complaints about foreign object (product not clear) in 1 day");
  const v = buildSpikeVars(g, 7, "https://crm.example.in/");
  assertEquals(v["1"], "Reputation spike");
  assertEquals(v["2"], "Masala Mania");
  assertEquals(v["3"], "foreign object");
  assertEquals(v["4"], "4 complaints in 7 days");
  assertEquals(v["5"], "Possible batch issue: 4 complaints about foreign object on Masala Mania in 7 days. https://crm.example.in/dashboard/reputation");
  noDash(v);
  const long = buildSpikeVars({ ...g, product: "P — " + "y".repeat(500) }, 7, "https://crm.example.in");
  noDash(long);
  assert(long["5"].endsWith("https://crm.example.in/dashboard/reputation"));
  assertEquals(buildSpikeVars({ ...g, product: null }, 7, "https://x.in")["2"], "Not sure which product");
});
