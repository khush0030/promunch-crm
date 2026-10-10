// AI visibility tracker (Reputation → AI visibility): types, brand matching
// and the summary math behind GET /api/orm/ai-visibility. Pure, no I/O.
// Spec: docs/plans/2026-10-10-ai-visibility-phase2/AI_VISIBILITY_TRACKER.md.
//
// MIRRORED: BRANDS, findBrands (+ proseOf), isAnswered and countRun are the
// same as promunch-email-agent/supabase/functions/_shared/ai-visibility.ts
// (the edge function stores what they return). Both suites assert
// ./ai-visibility-vectors.json, so change both copies and the vectors together
// or not at all.

export const OURS = "PROMUNCH";

export interface BrandDef {
  name: string;
  /** Lowercase match forms. Spaces inside an alias match any run of space, dot or hyphen (or nothing). */
  aliases: string[];
  /** Match the aliases exactly as written (for brand names that are also common words). */
  caseSensitive?: boolean;
}

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
  let answered = 0,
    errors = 0,
    category = 0,
    named = 0;
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

// ── Next only: brand recognition heuristic ─────────────────────────────────

// Phrases an assistant uses when it does not know a brand. A heuristic for
// the brand questions only ("does the AI know us?"); the full answer is
// always one tap away.
const UNKNOWN_RE =
  /\b(?:no|not (?:enough|much|any)|limited|little) (?:reliable |verified |verifiable |specific |credible |public |detailed )?(?:information|info|details|data|reviews)\b|\bnot (?:familiar|aware)\b|\b(?:couldn'?t|could not|cannot|can'?t|unable to|did not|didn'?t) (?:find|verify|confirm|locate)\b|\bdon'?t have (?:any )?(?:reliable |specific |verified )?(?:information|details|data)\b|\bnot (?:a )?(?:widely|well)[- ]known\b|\bno (?:clear |credible )?(?:record|results|presence)\b/i;

/**
 * For a brand question: true = the answer talks about PROMUNCH without saying
 * it cannot find or verify it; false = it says it does not know us (or never
 * names us); null = no usable answer.
 */
export function brandRecognised(r: Pick<CountRow, "error" | "answer" | "promunch_named">): boolean | null {
  if (!isAnswered(r)) return null;
  if (!r.promunch_named) return false;
  return !UNKNOWN_RE.test(r.answer ?? "");
}

// ── API types ───────────────────────────────────────────────────────────────

export type RunStatus = "running" | "done" | "partial" | "failed";

export interface AiVisRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  heartbeat_at: string | null;
  trigger: "cron" | "manual";
  triggered_by: string | null;
  status: RunStatus;
  model: string | null;
  planned: number;
  answered: number;
  errors: number;
  category_answered: number;
  named: number;
  cost_usd: number | string | null;
  error: string | null;
}

export interface AiVisResultRow {
  prompt_id: string | null;
  prompt_text: string;
  kind: "category" | "brand";
  topic: string | null;
  model: string | null;
  web_search: boolean;
  answer: string | null;
  promunch_named: boolean;
  promunch_rank: number | null;
  brands_named: string[] | null;
  citations: Array<{ url: string; title: string | null }> | null;
  error: string | null;
  cost_usd: number | string | null;
  created_at: string;
}

export interface AiVisPromptRow {
  id: string;
  key: string;
  prompt: string;
  kind: "category" | "brand";
  topic: string;
  active: boolean;
  sort: number;
}

export const RUN_COLUMNS =
  "id, started_at, finished_at, heartbeat_at, trigger, triggered_by, status, model, planned, answered, errors, category_answered, named, cost_usd, error";
export const RESULT_COLUMNS =
  "prompt_id, prompt_text, kind, topic, model, web_search, answer, promunch_named, promunch_rank, brands_named, citations, error, cost_usd, created_at";
export const PROMPT_COLUMNS = "id, key, prompt, kind, topic, active, sort";

/** Same as the edge: a 'running' row whose heartbeat is older than this is dead. */
export const STALE_MS = 10 * 60_000;
export const TREND_RUNS = 12;
const TOP_BRANDS = 10;

export interface PromptResult {
  prompt_id: string | null;
  key: string | null;
  topic: string;
  prompt: string;
  kind: "category" | "brand";
  from_audit: boolean;
  /** answered = a usable answer came back (else see error). */
  answered: boolean;
  named: boolean;
  rank: number | null;
  brands: string[];
  /** Brand questions only (see brandRecognised). */
  recognised: boolean | null;
  answer: string | null;
  citations: Array<{ url: string; title: string | null }>;
  web_search: boolean;
  error: string | null;
}

export interface BrandShare {
  brand: string;
  ours: boolean;
  /** Shopping answers that name the brand. */
  answers: number;
  /** answers / shopping answers in the run, 0..1. */
  share: number;
}

export interface TrendPoint {
  run_id: string;
  started_at: string;
  named: number;
  total: number;
  /** named / total, null when the run had no shopping answers. */
  share: number | null;
}

export interface AiVisibilitySummary {
  running: { run_id: string; started_at: string; planned: number; done: number; trigger: string } | null;
  latest: {
    run_id: string;
    started_at: string;
    finished_at: string | null;
    status: RunStatus;
    trigger: string;
    model: string | null;
    named: number;
    total: number;
    share: number | null;
    errors: number;
    cost_usd: number | null;
    error: string | null;
  } | null;
  prompts: PromptResult[];
  competitors: BrandShare[];
  trend: TrendPoint[];
  /** Active questions now (what the next run will ask). */
  active_prompts: number;
}

const toNum = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function isLive(run: Pick<AiVisRunRow, "status" | "heartbeat_at" | "started_at">, now = Date.now()): boolean {
  if (run.status !== "running") return false;
  const beat = Date.parse(run.heartbeat_at ?? run.started_at);
  return Number.isFinite(beat) && now - beat < STALE_MS;
}

/** Finished runs that produced answers (done or partial), newest first. */
export function finishedRuns(runs: AiVisRunRow[]): AiVisRunRow[] {
  return runs
    .filter((r) => r.status === "done" || r.status === "partial")
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

/** Shopping answers per brand in one run, PROMUNCH always listed. */
export function shareOfVoice(results: Pick<AiVisResultRow, "kind" | "error" | "answer" | "brands_named">[]): BrandShare[] {
  const answered = results.filter((r) => r.kind === "category" && isAnswered(r));
  const counts = new Map<string, number>();
  for (const r of answered) {
    for (const b of new Set(r.brands_named ?? [])) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const total = answered.length;
  const rows: BrandShare[] = [...counts.entries()]
    .map(([brand, n]) => ({ brand, ours: brand === OURS, answers: n, share: total ? n / total : 0 }))
    .sort((a, b) => b.answers - a.answers || a.brand.localeCompare(b.brand));
  const top = rows.filter((r) => !r.ours).slice(0, TOP_BRANDS);
  const ours = rows.find((r) => r.ours) ?? { brand: OURS, ours: true, answers: 0, share: 0 };
  return [...top, ours].sort((a, b) => b.answers - a.answers || (a.ours ? -1 : b.ours ? 1 : a.brand.localeCompare(b.brand)));
}

export function buildAiVisibilitySummary(input: {
  runs: AiVisRunRow[];
  /** Results of the latest finished run. */
  results: AiVisResultRow[];
  prompts: AiVisPromptRow[];
  /** Results already stored for the live run (progress). */
  running_done?: number;
  now?: number;
}): AiVisibilitySummary {
  const now = input.now ?? Date.now();
  const live = input.runs.find((r) => isLive(r, now)) ?? null;
  const finished = finishedRuns(input.runs);
  const last = finished[0] ?? null;

  const promptById = new Map(input.prompts.map((p) => [p.id, p]));
  const sortOf = (r: AiVisResultRow) => promptById.get(r.prompt_id ?? "")?.sort ?? 10_000;
  const results = last ? [...input.results].sort((a, b) => sortOf(a) - sortOf(b) || a.prompt_text.localeCompare(b.prompt_text)) : [];

  const counts = countRun(results);
  const prompts: PromptResult[] = results.map((r) => {
    const p = r.prompt_id ? promptById.get(r.prompt_id) : undefined;
    const answered = isAnswered(r);
    return {
      prompt_id: r.prompt_id,
      key: p?.key ?? null,
      topic: r.topic || p?.topic || "Question",
      prompt: r.prompt_text,
      kind: r.kind,
      from_audit: !!p?.key.startsWith("audit_"),
      answered,
      named: answered && r.promunch_named,
      rank: answered ? r.promunch_rank : null,
      brands: answered ? (r.brands_named ?? []) : [],
      recognised: r.kind === "brand" ? brandRecognised(r) : null,
      answer: r.answer,
      citations: Array.isArray(r.citations) ? r.citations : [],
      web_search: !!r.web_search,
      error: r.error ?? (answered ? null : "No answer text"),
    };
  });

  const trend: TrendPoint[] = finished
    .slice(0, TREND_RUNS)
    .reverse()
    .map((r) => ({
      run_id: r.id,
      started_at: r.started_at,
      named: r.named,
      total: r.category_answered,
      share: r.category_answered ? r.named / r.category_answered : null,
    }));

  return {
    running: live
      ? {
          run_id: live.id,
          started_at: live.started_at,
          planned: live.planned,
          done: input.running_done ?? 0,
          trigger: live.trigger,
        }
      : null,
    latest: last
      ? {
          run_id: last.id,
          started_at: last.started_at,
          finished_at: last.finished_at,
          status: last.status,
          trigger: last.trigger,
          model: last.model,
          // recomputed from the rows so the headline always matches the list
          named: counts.named,
          total: counts.category_answered,
          share: counts.category_answered ? counts.named / counts.category_answered : null,
          errors: counts.errors,
          cost_usd: toNum(last.cost_usd),
          error: last.error,
        }
      : null,
    prompts,
    competitors: last ? shareOfVoice(results) : [],
    trend,
    active_prompts: input.prompts.filter((p) => p.active).length,
  };
}
