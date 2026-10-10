// AI visibility tracker: pure helpers (no Deno APIs, no network, no DB).
// Spec: docs/plans/2026-10-10-ai-visibility-phase2/AI_VISIBILITY_TRACKER.md.
//
// MIRRORED in src/lib/orm/ai-visibility.ts (Next.js). Both test suites assert
// the same vectors file, src/lib/orm/ai-visibility-vectors.json (brand list,
// matching cases, run counts), so change both copies and the vectors together
// or not at all. Mirrored: BRANDS, findBrands (+ proseOf), isAnswered,
// countRun. Edge only: the OpenAI request/response and cost helpers.
//
//   findBrands(text)            which brands an AI answer names, in order of
//                               first mention, and PROMUNCH's rank among them
//   parseResponsesOutput(json)  answer text + url_citation sources + search
//                               call count from an OpenAI Responses API reply
//   estimateCostUsd(...)        rough USD for one answer (tokens + search fee)
//   countRun(rows)              the counts stored on ai_visibility_runs

export const OURS = "PROMUNCH";

export interface BrandDef {
  name: string;
  /** Lowercase match forms. Spaces inside an alias match any run of space, dot or hyphen (or nothing). */
  aliases: string[];
  /** Match the aliases exactly as written (for brand names that are also common words). */
  caseSensitive?: boolean;
}

// PROMUNCH first, then the brands the 10 Oct 2026 audit saw, then niche
// snack brands we compete with on soya, namkeen, makhana and chips swaps.
export const BRANDS: BrandDef[] = [
  { name: OURS, aliases: ["pro munch", "trypromunch"] },
  { name: "MuscleBlaze", aliases: ["muscle blaze"] },
  { name: "RiteBite", aliases: ["rite bite"] },
  { name: "Yoga Bar", aliases: ["yoga bar"] },
  { name: "The Whole Truth", aliases: ["the whole truth", "whole truth"] },
  { name: "OZiva", aliases: ["oziva"] },
  { name: "Unived", aliases: ["unived"] },
  { name: "Happilo", aliases: ["happilo"] },
  { name: "Farmley", aliases: ["farmley"] },
  { name: "Optimum Nutrition", aliases: ["optimum nutrition"] },
  { name: "Urban Platter", aliases: ["urban platter"] },
  { name: "Nutraj", aliases: ["nutraj"] },
  { name: "Pintola", aliases: ["pintola"] },
  { name: "Slurrp Farm", aliases: ["slurrp farm", "slurp farm"] },
  { name: "Epigamia", aliases: ["epigamia"] },
  { name: "Power Gummies", aliases: ["power gummies"] },
  { name: "GNC", aliases: ["gnc"] },
  { name: "Dimension", aliases: ["Dimension"], caseSensitive: true },
  { name: "Nutrabay", aliases: ["nutrabay"] },
  { name: "Alpino", aliases: ["alpino"] },
  { name: "Haldiram's", aliases: ["haldiram", "haldirams"] },
  { name: "Bikaji", aliases: ["bikaji"] },
  { name: "Bikano", aliases: ["bikano"] },
  { name: "Too Yumm", aliases: ["too yumm"] },
  { name: "Open Secret", aliases: ["Open Secret", "OpenSecret"], caseSensitive: true },
  { name: "Snackible", aliases: ["snackible"] },
  { name: "Soulfull", aliases: ["soulfull"] },
  { name: "True Elements", aliases: ["true elements"] },
  { name: "Wingreens", aliases: ["wingreens"] },
  { name: "Phab", aliases: ["phab"] },
  { name: "The Eat Better Co", aliases: ["eat better co", "eat better company"] },
  { name: "Healthy Master", aliases: ["healthy master"] },
  { name: "Mr. Makhana", aliases: ["mr makhana"] },
  { name: "SuperYou", aliases: ["super you"] },
  { name: "Amul", aliases: ["amul"] },
  { name: "Cornitos", aliases: ["cornitos"] },
  { name: "Myprotein", aliases: ["myprotein", "my protein"] },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function aliasPattern(alias: string): string {
  return alias.trim().split(/\s+/).map(escapeRe).join("[\\s.\\-]*");
}

// Word-boundary aware: the alias may not sit inside a longer word or number
// ("promunchies" is not PROMUNCH; "Pro-Munch", "promunch.in" and
// "trypromunch.in" are).
const MATCHERS: Array<{ name: string; re: RegExp }> = BRANDS.map((b) => ({
  name: b.name,
  re: new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${b.aliases.map(aliasPattern).join("|")})(?![\\p{L}\\p{N}])`,
    b.caseSensitive ? "u" : "iu",
  ),
}));

/**
 * Prose only: markdown link targets and bare URLs are dropped (a cited
 * amazon.in/...muscleblaze... URL is not the answer naming the brand), link
 * text and bare domains in prose ("promunch.in") are kept, curly apostrophes
 * become straight ones.
 */
export function proseOf(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, "$1")
    .replace(/https?:\/\/[^\s)\]]+/gi, " ");
}

export interface BrandMatch {
  /** Canonical names in order of first mention, PROMUNCH included when named. */
  brands: string[];
  promunch_named: boolean;
  /** 1-based position of PROMUNCH among the brands found, null when not named. */
  promunch_rank: number | null;
}

export function findBrands(text: string | null | undefined): BrandMatch {
  const prose = proseOf(text ?? "");
  const hits: Array<{ name: string; at: number }> = [];
  for (const m of MATCHERS) {
    const r = m.re.exec(prose);
    if (r) hits.push({ name: m.name, at: r.index });
  }
  hits.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
  const brands = hits.map((h) => h.name);
  const i = brands.indexOf(OURS);
  return { brands, promunch_named: i >= 0, promunch_rank: i >= 0 ? i + 1 : null };
}

// ---- OpenAI Responses API (edge only, not mirrored) --------------------------

/**
 * One shopper question, asked the way a person would: no system prompt, the
 * built-in web_search tool on (the model decides when to search, like the
 * consumer assistants do) with an approximate location of India, so answers
 * reflect what is on the web today. store:false keeps it out of OpenAI's
 * stored responses. Reasoning models count reasoning toward
 * max_output_tokens, hence the headroom.
 * Shape: https://platform.openai.com/docs/guides/tools-web-search
 */
export function buildResponsesRequest(model: string, prompt: string): Record<string, unknown> {
  return {
    model,
    input: prompt,
    tools: [{ type: "web_search", user_location: { type: "approximate", country: "IN" } }],
    max_output_tokens: 3000,
    store: false,
  };
}

// ---- OpenAI Responses API output --------------------------------------------

export interface Citation {
  url: string;
  title: string | null;
}

export interface ParsedAnswer {
  answer: string;
  citations: Citation[];
  /** web_search_call items in the output (each is billed as one tool call). */
  search_calls: number;
  /** "completed", "incomplete", ... as OpenAI reports it. */
  status: string | null;
  incomplete_reason: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

const MAX_CITATIONS = 20;

/** Drops OpenAI's utm_source=openai tag so the same page de-dups. */
export function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.delete("utm_source");
    const s = u.toString();
    return s.endsWith("?") ? s.slice(0, -1) : s;
  } catch {
    return raw;
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Loose shapes of the raw OpenAI Responses JSON; every field is checked before use.
interface RawAnnotation { type?: unknown; url?: unknown; title?: unknown }
interface RawPart { type?: unknown; text?: unknown; annotations?: unknown }
interface RawItem { type?: unknown; content?: unknown }
interface RawResponse {
  output?: unknown;
  status?: unknown;
  incomplete_details?: { reason?: unknown } | null;
  model?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown } | null;
}

export function parseResponsesOutput(raw: unknown): ParsedAnswer {
  const json = (raw && typeof raw === "object" ? raw : {}) as RawResponse;
  const output: unknown[] = Array.isArray(json.output) ? json.output : [];
  const texts: string[] = [];
  const seen = new Set<string>();
  const citations: Citation[] = [];
  let searchCalls = 0;
  for (const item of output as (RawItem | null)[]) {
    if (item?.type === "web_search_call") {
      searchCalls++;
      continue;
    }
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content as (RawPart | null)[]) {
      if (part?.type !== "output_text" || typeof part.text !== "string") continue;
      texts.push(part.text);
      const annotations = (Array.isArray(part.annotations) ? part.annotations : []) as (RawAnnotation | null)[];
      for (const a of annotations) {
        if (a?.type !== "url_citation" || typeof a.url !== "string" || !a.url) continue;
        const url = cleanUrl(a.url);
        if (seen.has(url) || citations.length >= MAX_CITATIONS) continue;
        seen.add(url);
        citations.push({ url, title: typeof a.title === "string" && a.title.trim() ? a.title.trim() : null });
      }
    }
  }
  return {
    answer: texts.join("\n\n").trim(),
    citations,
    search_calls: searchCalls,
    status: typeof json.status === "string" ? json.status : null,
    incomplete_reason: typeof json.incomplete_details?.reason === "string" ? json.incomplete_details.reason : null,
    model: typeof json.model === "string" ? json.model : null,
    input_tokens: num(json.usage?.input_tokens),
    output_tokens: num(json.usage?.output_tokens),
  };
}

// ---- cost estimate ------------------------------------------------------------

// USD per 1M tokens, from https://platform.openai.com/docs/pricing (Oct 2026).
// fixedSearchBlock: for these models every web search call bills a fixed
// 8,000 input-token block of search content. Longest prefix wins, so dated
// snapshots ("gpt-4.1-mini-2025-04-14") price like their family.
const PRICES: Array<{ prefix: string; input: number; output: number; fixedSearchBlock?: number }> = [
  { prefix: "gpt-4.1-mini", input: 0.4, output: 1.6, fixedSearchBlock: 8000 },
  { prefix: "gpt-4.1-nano", input: 0.1, output: 0.4 },
  { prefix: "gpt-4.1", input: 2, output: 8 },
  { prefix: "gpt-4o-mini", input: 0.15, output: 0.6, fixedSearchBlock: 8000 },
  { prefix: "gpt-4o", input: 2.5, output: 10 },
  { prefix: "gpt-5-nano", input: 0.05, output: 0.4 },
  { prefix: "gpt-5-mini", input: 0.25, output: 2 },
  { prefix: "gpt-5", input: 1.25, output: 10 },
];
/** Web search tool fee: $10 per 1,000 calls. */
export const SEARCH_CALL_USD = 0.01;

/**
 * Rough USD for one answer. Unknown model → only the search fee is counted.
 * For fixed-block models the 8,000-token block is added only when the
 * reported input tokens are smaller than the blocks (i.e. clearly not already
 * included), so this leans to an upper bound rather than double counting.
 */
export function estimateCostUsd(
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
  searchCalls: number,
): number {
  const m = (model ?? "").toLowerCase();
  const p = PRICES.filter((x) => m.startsWith(x.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  let usd = Math.max(0, searchCalls) * SEARCH_CALL_USD;
  if (p) {
    let inTok = inputTokens ?? 0;
    const block = (p.fixedSearchBlock ?? 0) * Math.max(0, searchCalls);
    if (block && inTok < block) inTok += block;
    usd += (inTok * p.input + (outputTokens ?? 0) * p.output) / 1_000_000;
  }
  return Math.round(usd * 100_000) / 100_000;
}

// ---- run counts ---------------------------------------------------------------

export interface CountRow {
  kind: string | null; // 'category' | 'brand'
  error: string | null;
  answer: string | null;
  promunch_named: boolean | null;
}

export interface RunCounts {
  /** Rows with a usable answer (no error, non-empty text). */
  answered: number;
  errors: number;
  /** Shopping (category) questions answered: the "Y" in "named in X of Y". */
  category_answered: number;
  /** Category answers that name PROMUNCH: the "X". */
  named: number;
}

export function isAnswered(r: Pick<CountRow, "error" | "answer">): boolean {
  return !r.error && !!(r.answer ?? "").trim();
}

export function countRun(rows: CountRow[]): RunCounts {
  let answered = 0, errors = 0, category = 0, named = 0;
  for (const r of rows) {
    if (!isAnswered(r)) {
      errors++;
      continue;
    }
    answered++;
    if (r.kind === "category") {
      category++;
      if (r.promunch_named) named++;
    }
  }
  return { answered, errors, category_answered: category, named };
}
