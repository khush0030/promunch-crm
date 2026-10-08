import { assert, assertEquals } from "jsr:@std/assert";
import {
  applyHardRules,
  buildEnrichUser,
  cleanSummary,
  ENRICH_BODY_MAX,
  ENRICH_SCHEMA,
  type Enrichment,
  extractOrderRef,
  isFoodSafety,
  parseEnrichResponse,
  TOPICS,
} from "./orm-enrich.ts";

const base: Enrichment = {
  relevant: true, sentiment: 0, summary: "s", topics: [], intent: "other", urgency: "normal",
  product: null, language: "en", order_ref: null,
};

Deno.test("food-safety regex", () => {
  for (const t of ["found an INSECT", "fungal growth", "it smells", "kida tha", "ganda taste", "got sick", "allergic reaction", "hair in packet", "plastic piece inside"]) {
    assert(isFoodSafety(t), t);
  }
  for (const t of ["super crunchy", "late delivery", "too salty"]) assert(!isFoodSafety(t), t);
});

Deno.test("hard rules: food safety forces critical, owned forces relevant, order ref fallback", () => {
  const e = applyHardRules({ ...base, urgency: "low", relevant: false }, { title: null, body: "Stale pack, order 2083", is_owned: true });
  assertEquals(e.urgency, "critical");
  assertEquals(e.relevant, true);
  assertEquals(e.order_ref, "#2083");
  const e2 = applyHardRules({ ...base, relevant: false }, { body: "nice", is_owned: false });
  assertEquals(e2.relevant, false);
  assertEquals(e2.urgency, "normal");
});

Deno.test("extractOrderRef", () => {
  assertEquals(extractOrderRef("my order #2083 is late"), "#2083");
  assertEquals(extractOrderRef("Order no. 10234"), "#10234");
  assertEquals(extractOrderRef("rated 5 stars"), null);
});

Deno.test("prompt carries ids and caps body", () => {
  const u = buildEnrichUser([{ id: "m1", source: "amazon", rating: 2, title: "t", body: "x".repeat(4000), author_followers: null }]);
  const payload = JSON.parse(u.slice(u.indexOf("\n\n") + 2));
  assertEquals(payload[0].id, "m1");
  assertEquals(payload[0].body.length, ENRICH_BODY_MAX);
});

Deno.test("schema lists every topic and is strict", () => {
  assertEquals(ENRICH_SCHEMA.strict, true);
  assertEquals(ENRICH_SCHEMA.schema.properties.items.items.properties.topics.items.enum.length, TOPICS.length);
});

Deno.test("parse: valid, clamped, unknown ids/topics dropped, missing ids absent", () => {
  const raw = JSON.stringify({
    items: [
      { id: "a", relevant: true, sentiment: -5, summary: "Customer says promunch pack was stale — wants refund", topics: ["freshness", "bogus"], intent: "complaint", urgency: "high", product: "Soya Crunchies", language: "en", order_ref: "2083" },
      { id: "zzz", relevant: true, sentiment: 1, summary: "x", topics: [], intent: "praise", urgency: "low", product: null, language: "en", order_ref: null },
      { id: "b", relevant: false, sentiment: 0, summary: "", topics: [], intent: "weird", urgency: "nope", product: "", language: "", order_ref: null },
    ],
  });
  const out = parseEnrichResponse(raw, ["a", "b", "c"]);
  assertEquals([...out.keys()].sort(), ["a", "b"]);
  const a = out.get("a")!;
  assertEquals(a.sentiment, -2);
  assertEquals(a.topics, ["freshness"]);
  assertEquals(a.order_ref, "#2083");
  assert(!a.summary.includes("—"));
  assert(a.summary.includes("PROMUNCH"));
  const b = out.get("b")!;
  assertEquals(b.intent, "other");
  assertEquals(b.urgency, "normal");
  assertEquals(b.product, null);
  assertEquals(b.relevant, false);
});

Deno.test("parse: garbage and fenced JSON", () => {
  assertEquals(parseEnrichResponse("not json", ["a"]).size, 0);
  const fenced = "```json\n{\"items\":[{\"id\":\"a\",\"sentiment\":1}]}\n```";
  assertEquals(parseEnrichResponse(fenced, ["a"]).get("a")?.sentiment, 1);
});

Deno.test("cleanSummary caps at 140", () => {
  assertEquals(cleanSummary("y".repeat(300)).length, 140);
});
