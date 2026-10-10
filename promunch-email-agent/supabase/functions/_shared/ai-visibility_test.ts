import { assertEquals } from "jsr:@std/assert@1";
import {
  BRANDS,
  buildResponsesRequest,
  cleanUrl,
  countRun,
  type CountRow,
  estimateCostUsd,
  findBrands,
  parseResponsesOutput,
} from "./ai-visibility.ts";

// Shared with the Next.js copy (src/lib/orm/ai-visibility.ts): same file, same answers.
const VECTORS_URL = new URL("../../../../src/lib/orm/ai-visibility-vectors.json", import.meta.url);
const vectors = JSON.parse(await Deno.readTextFile(VECTORS_URL)) as {
  brands: unknown;
  match: Array<{ name: string; text: string; expected: unknown }>;
  counts: Array<{ name: string; rows: CountRow[]; expected: unknown }>;
};

Deno.test("brand list matches the vectors (and so the Next.js copy)", () => {
  assertEquals(JSON.parse(JSON.stringify(BRANDS)), vectors.brands);
});

for (const m of vectors.match) {
  Deno.test(`findBrands: ${m.name}`, () => assertEquals(findBrands(m.text), m.expected));
}

for (const c of vectors.counts) {
  Deno.test(`countRun: ${c.name}`, () => assertEquals(countRun(c.rows), c.expected));
}

Deno.test("request: web_search tool with India location, no system prompt", () => {
  assertEquals(buildResponsesRequest("gpt-4.1-mini", "best soya snacks"), {
    model: "gpt-4.1-mini",
    input: "best soya snacks",
    tools: [{ type: "web_search", user_location: { type: "approximate", country: "IN" } }],
    max_output_tokens: 3000,
    store: false,
  });
});

Deno.test("parseResponsesOutput: text, de-duped citations, search calls, usage", () => {
  const json = {
    status: "completed",
    model: "gpt-4.1-mini-2025-04-14",
    usage: { input_tokens: 9100, output_tokens: 640 },
    output: [
      { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "soya snacks" } },
      { type: "web_search_call", id: "ws_2", status: "completed", action: { type: "search", query: "namkeen" } },
      {
        type: "message",
        role: "assistant",
        content: [{
          type: "output_text",
          text: "1. PROMUNCH Roasted Edamame ([promunch.in](https://promunch.in/?utm_source=openai))",
          annotations: [
            { type: "url_citation", url: "https://promunch.in/?utm_source=openai", title: "PROMUNCH", start_index: 0, end_index: 10 },
            { type: "url_citation", url: "https://promunch.in/", title: "dup" },
            { type: "url_citation", url: "https://www.amazon.in/dp/B0X?utm_source=openai&th=1", title: "  " },
          ],
        }],
      },
    ],
  };
  const p = parseResponsesOutput(json);
  assertEquals(p.answer, "1. PROMUNCH Roasted Edamame ([promunch.in](https://promunch.in/?utm_source=openai))");
  assertEquals(p.citations, [
    { url: "https://promunch.in/", title: "PROMUNCH" },
    { url: "https://www.amazon.in/dp/B0X?th=1", title: null },
  ]);
  assertEquals(p.search_calls, 2);
  assertEquals([p.status, p.model, p.input_tokens, p.output_tokens], ["completed", "gpt-4.1-mini-2025-04-14", 9100, 640]);
  // the link text names us, the link target alone would not
  assertEquals(findBrands(p.answer).promunch_rank, 1);
});

Deno.test("parseResponsesOutput: incomplete with no text", () => {
  const p = parseResponsesOutput({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
  assertEquals([p.answer, p.status, p.incomplete_reason, p.search_calls], ["", "incomplete", "max_output_tokens", 0]);
  assertEquals(parseResponsesOutput(null).answer, "");
});

Deno.test("cleanUrl keeps other params and bad URLs", () => {
  assertEquals(cleanUrl("https://a.in/x?utm_source=openai"), "https://a.in/x");
  assertEquals(cleanUrl("not a url"), "not a url");
});

Deno.test("estimateCostUsd", () => {
  // gpt-4.1-mini, 1 search, 300 in (block not included → +8000), 700 out:
  // 0.01 + (8300 * 0.4 + 700 * 1.6) / 1e6 = 0.01444
  assertEquals(estimateCostUsd("gpt-4.1-mini-2025-04-14", 300, 700, 1), 0.01444);
  // input already includes the block → not added again: 0.01 + (9100*0.4 + 640*1.6)/1e6
  assertEquals(estimateCostUsd("gpt-4.1-mini", 9100, 640, 1), 0.01466);
  // gpt-4.1 (not gpt-4.1-mini) prices by the longer prefix only when it matches
  assertEquals(estimateCostUsd("gpt-4.1", 1000, 1000, 0), 0.01);
  // unknown model → search fee only
  assertEquals(estimateCostUsd("some-new-model", 5000, 5000, 2), 0.02);
});
