import { assert, assertEquals } from "jsr:@std/assert";
import {
  amazonBudget,
  amazonPlan,
  amazonNextAsin,
  amazonRunInput,
  apifyRunCost,
  applyRelevance,
  BODY_MAX,
  cleanAsins,
  cleanText,
  istMonth,
  judgemePage,
  type MentionInput,
  normalizeAmazonReview,
  normalizeFeedEntry,
  normalizeRedditListing,
  normalizeYoutubeCommentThread,
  normalizeYoutubeSearchItem,
  parseAmazonDate,
  parseFeed,
  sha1Hex,
  unwrapGoogleUrl,
} from "./orm-sources.ts";

const fx = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/orm/${name}`, import.meta.url));
const json = (name: string) => JSON.parse(fx(name));

Deno.test("cleanText strips HTML, decodes entities, caps length", () => {
  assertEquals(cleanText("<p>Crunchy &amp; tasty</p><p>yes</p>"), "Crunchy & tasty\nyes");
  assertEquals(cleanText("&lt;b&gt;PROMUNCH&lt;/b&gt; news"), "PROMUNCH news");
  assertEquals(cleanText("<script>x()</script>hi"), "hi");
  assertEquals(cleanText("a".repeat(5000)).length, BODY_MAX);
  assertEquals(cleanText(null), "");
});

Deno.test("judgeme page: newer than cursor only, PII not in raw, stops at cursor", () => {
  const p = judgemePage(json("judgeme_reviews.json"), 1500, 100);
  assertEquals(p.mentions.map((m) => m.external_id), ["1503", "1502"]);
  assertEquals(p.maxId, 1503);
  assertEquals(p.more, false); // reached the cursor
  const m = p.mentions[0];
  assertEquals(m.source, "judgeme");
  assertEquals(m.is_owned, true);
  assertEquals(m.rating, 5);
  assertEquals(m.title, "Best protein snack");
  assertEquals(m.body, "Masala Mania is addictive & crunchy.\nWill reorder!");
  assertEquals(m.author_name, "Asha R");
  assertEquals(m.url, "https://promunch.in/products/roasted-edamame-masala-mania");
  assertEquals(m.product_ref, "roasted-edamame-masala-mania");
  assertEquals(m.posted_at, "2026-10-07T04:45:00.000Z");
  const raw = JSON.stringify(m.raw);
  assert(!raw.includes("a@example.com") && !raw.includes("9800000000") && !raw.includes("1.2.3.4"));
});

Deno.test("judgeme first run (no cursor) takes everything; full page means more", () => {
  const p = judgemePage(json("judgeme_reviews.json"), 0, 3);
  assertEquals(p.mentions.length, 3);
  assertEquals(p.more, true);
});

Deno.test("youtube comment thread → owned mention", () => {
  const m = normalizeYoutubeCommentThread(json("youtube_comment_threads.json").items[0])!;
  assertEquals(m.external_id, "UgzThread1");
  assertEquals(m.is_owned, true);
  assertEquals(m.product_ref, "vid123");
  assertEquals(m.parent_external_id, "video:vid123");
  assertEquals(m.body, "Where can I buy this in Pune?");
  assertEquals(m.url, "https://www.youtube.com/watch?v=vid123&lc=UgzThread1");
  assertEquals(m.author_name, "@foodie_pune");
});

Deno.test("youtube search → video mentions, own channel excluded", () => {
  const items = json("youtube_search.json").items;
  const out = items.map((i: unknown) => normalizeYoutubeSearchItem(i, "UCpromunch")).filter(Boolean) as MentionInput[];
  assertEquals(out.length, 1);
  assertEquals(out[0].external_id, "video:abcXYZ");
  assertEquals(out[0].is_owned, false);
  assertEquals(out[0].title, "Honest PROMUNCH review & taste test");
  assertEquals(out[0].author_name, "Snack Reviews India");
});

Deno.test("reddit listing → t3 + t1, 'more' ignored, deleted author nulled", () => {
  const out = normalizeRedditListing(json("reddit_search.json"));
  assertEquals(out.map((m) => m.external_id), ["t3_1abcd", "t1_c9"]);
  assertEquals(out[0].url, "https://www.reddit.com/r/IndianFood/comments/1abcd/anyone_tried_promunch/");
  assertEquals(out[0].author_handle, "u/snackguy");
  assertEquals(out[0].posted_at, new Date(1759900000 * 1000).toISOString());
  assertEquals(out[1].author_name, null);
  assertEquals(out[1].title, "Anyone tried Promunch edamame?");
  assertEquals(out[1].parent_external_id, "t3_1abcd");
  assertEquals(out[1].body, "Promunch crunchies are great with chai");
});

Deno.test("google alerts atom → entries, google redirect unwrapped, sha1 id", async () => {
  const entries = parseFeed(fx("google_alerts.xml"));
  assertEquals(entries.length, 2);
  assertEquals(entries[0].title, "PROMUNCH raises seed round for protein snacks");
  assertEquals(entries[0].content, "Indore based Promunch makes roasted edamame & soya snacks ...");
  assertEquals(entries[0].published, "2026-10-08T05:30:00.000Z");
  const m = (await normalizeFeedEntry(entries[0], "https://feed"))!;
  assertEquals(m.url, "https://example-news.in/startups/promunch-seed");
  assertEquals(m.external_id, await sha1Hex("https://example-news.in/startups/promunch-seed"));
  assertEquals(m.author_name, "example-news.in");
  assertEquals(m.external_id.length, 40);
});

Deno.test("unwrapGoogleUrl leaves normal links alone", () => {
  assertEquals(unwrapGoogleUrl("https://blog.example.com/post"), "https://blog.example.com/post");
  assertEquals(unwrapGoogleUrl("https://www.google.com/url?url=https://x.in/a&ct=ga"), "https://x.in/a");
  assertEquals(unwrapGoogleUrl("not a url"), "not a url");
});

Deno.test("parseFeed RSS 2.0 fallback", () => {
  const xml = `<rss><channel><item><title>PROMUNCH in news</title><link>https://n.in/a</link><pubDate>Wed, 08 Oct 2026 05:00:00 GMT</pubDate><description><![CDATA[<p>hello</p>]]></description></item></channel></rss>`;
  const e = parseFeed(xml);
  assertEquals(e.length, 1);
  assertEquals(e[0].link, "https://n.in/a");
  assertEquals(e[0].content, "hello");
  assertEquals(e[0].published, "2026-10-08T05:00:00.000Z");
});

Deno.test("amazon (axesso) → reviews, star prefix stripped, error rows dropped", () => {
  const out = json("amazon_axesso.json").map(normalizeAmazonReview).filter(Boolean) as MentionInput[];
  assertEquals(out.length, 2);
  assertEquals(out[0].external_id, "R2ABCDEF123");
  assertEquals(out[0].rating, 5);
  assertEquals(out[0].title, "Tasty and crunchy");
  assertEquals(out[0].product_ref, "B0CXYZ1234");
  assertEquals(out[0].posted_at, "2026-10-05T00:00:00.000Z");
  assertEquals(out[0].url, "https://www.amazon.in/gp/customer-reviews/R2ABCDEF123");
  assertEquals(out[0].is_owned, true);
  assertEquals(out[1].rating, 1);
});

Deno.test("amazon junglee-style fields also accepted", () => {
  const m = normalizeAmazonReview({ reviewId: "RX", reviewTitle: "ok", reviewDescription: "fine", ratingScore: 3, date: "2026-10-01", productAsin: "B000000001" })!;
  assertEquals(m.rating, 3);
  assertEquals(m.body, "fine");
  assertEquals(m.product_ref, "B000000001");
  assertEquals(m.posted_at, "2026-10-01T00:00:00.000Z");
});

Deno.test("parseAmazonDate formats", () => {
  assertEquals(parseAmazonDate("Reviewed in India on 5 October 2026"), "2026-10-05T00:00:00.000Z");
  assertEquals(parseAmazonDate("Reviewed in the United States on October 5, 2026"), "2026-10-05T00:00:00.000Z");
  assertEquals(parseAmazonDate(""), null);
  assertEquals(parseAmazonDate("garbage"), null);
});

Deno.test("amazon plan + hard budget guard", () => {
  const plan = amazonPlan(["A", "B"], 20);
  assertEquals(plan.perAsin, 20);
  assertEquals(plan.maxReviews, 40);
  assertEquals(plan.estimateUsd, 0.292); // $0.0073/review (junglee free tier incl. date filter)
  const s = { apify_month: "2026-10", apify_spent_usd: "4.95", apify_monthly_budget_usd: "5" };
  assertEquals(amazonBudget(s, "2026-10", 0.08).ok, false);
  assertEquals(amazonBudget(s, "2026-10", 0.05).ok, true); // exactly at the cap is allowed
  const reset = amazonBudget(s, "2026-11", 0.08);
  assertEquals(reset.ok, true);
  assertEquals(reset.monthReset, true);
  assertEquals(reset.spent, 0);
  assertEquals(amazonBudget({ apify_month: null, apify_spent_usd: 0, apify_monthly_budget_usd: 0 }, "2026-10", 0.01).ok, false);
});

Deno.test("apifyRunCost takes the larger of usage and PPE events", () => {
  assertEquals(apifyRunCost({ usageTotalUsd: 0.01 }, 0), 0.01);
  assertEquals(apifyRunCost({ usageTotalUsd: 0, chargedEventCounts: { result: 100 } }, 0), 0.73);
  assertEquals(apifyRunCost({}, 50), 0.365);
});

Deno.test("amazonRunInput: amazon.in product urls, recent sort, cut-off from newest review", () => {
  const first = amazonRunInput(["B09D83MH1Q"], 10, null);
  assertEquals(first.productUrls, [{ url: "https://www.amazon.in/dp/B09D83MH1Q" }]);
  assertEquals(first.maxReviews, 10);
  assertEquals(first.sort, "recent");
  assertEquals(first.includeGdprSensitive, false);
  assertEquals("reviewsCutoffDate" in first, false);
  assertEquals(amazonRunInput(["B09D83MH1Q"], 10, "2026-10-05T00:00:00.000Z").reviewsCutoffDate, "2026-10-04");
  assertEquals(amazonRunInput(["A000000001", "A000000002", "A000000003"], 10, null).maxReviews, 30);
});

Deno.test("amazonNextAsin rotates one ASIN per run", () => {
  const a = ["A000000001", "A000000002", "A000000003"];
  assertEquals(amazonNextAsin(a, undefined), { asin: "A000000001", nextIdx: 1 });
  assertEquals(amazonNextAsin(a, 2), { asin: "A000000003", nextIdx: 0 });
  assertEquals(amazonNextAsin(a, 7), { asin: "A000000002", nextIdx: 2 }); // list shrank
});

Deno.test("amazon (junglee) item normalizes", () => {
  const m = normalizeAmazonReview({
    reviewId: "R1ABC", productAsin: "B09D83MH1Q", reviewTitle: "Stale jar", reviewDescription: "Crunchies were stale.",
    ratingScore: 1, date: "2026-10-05", reviewUrl: "https://www.amazon.in/gp/customer-reviews/R1ABC", isVerified: true,
  });
  assertEquals(m?.external_id, "R1ABC");
  assertEquals(m?.product_ref, "B09D83MH1Q");
  assertEquals(m?.rating, 1);
  assertEquals(m?.body, "Crunchies were stale.");
  assertEquals(m?.posted_at?.slice(0, 10), "2026-10-05");
});

Deno.test("istMonth uses IST", () => {
  assertEquals(istMonth(Date.parse("2026-10-31T19:00:00Z")), "2026-11"); // 00:30 IST Nov 1
  assertEquals(istMonth(Date.parse("2026-10-31T18:00:00Z")), "2026-10");
});

Deno.test("cleanAsins validates and de-dups", () => {
  assertEquals(cleanAsins([" b0cxyz1234", "B0CXYZ1234", "bad", ""]), ["B0CXYZ1234"]);
});

Deno.test("relevance pre-filter: keyword or owned; exclude → relevant=false", () => {
  const base: MentionInput = {
    source: "reddit", external_id: "x", url: null, author_name: null, author_handle: null,
    author_followers: null, title: null, body: "", rating: null, posted_at: null, is_owned: false,
    product_ref: null, parent_external_id: null, raw: {},
  };
  const ms: MentionInput[] = [
    { ...base, external_id: "1", body: "I love ProMunch" },
    { ...base, external_id: "2", body: "nothing about us" },
    { ...base, external_id: "3", source: "judgeme", body: "great" },
    { ...base, external_id: "4", source: "youtube", is_owned: true, body: "where to buy" },
    { ...base, external_id: "5", title: "Promunch giveaway", body: "crypto airdrop" },
  ];
  const out = applyRelevance(ms, ["promunch", "pro munch"], ["airdrop"]);
  assertEquals(out.map((m) => m.external_id), ["1", "3", "4", "5"]);
  assertEquals(out[3].relevant, false);
  assertEquals(out[0].relevant, undefined);
});
