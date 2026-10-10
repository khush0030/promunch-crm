import { describe, expect, it } from "vitest";
import {
  BRANDS,
  brandRecognised,
  buildAiVisibilitySummary,
  countRun,
  findBrands,
  isLive,
  shareOfVoice,
  type AiVisPromptRow,
  type AiVisResultRow,
  type AiVisRunRow,
  type BrandMatch,
  type CountRow,
  type RunCounts,
} from "./ai-visibility";
import vectors from "./ai-visibility-vectors.json";

const V = vectors as unknown as {
  brands: typeof BRANDS;
  match: { name: string; text: string; expected: BrandMatch }[];
  counts: { name: string; rows: CountRow[]; expected: RunCounts }[];
};

// Shared with the edge copy (_shared/ai-visibility.ts): both suites assert this file.
describe("ai visibility: shared vectors", () => {
  it("brand list matches the vectors (and so the edge copy)", () => {
    expect(BRANDS).toEqual(V.brands);
  });
  for (const m of V.match) {
    it(`findBrands: ${m.name}`, () => {
      expect(findBrands(m.text)).toEqual(m.expected);
    });
  }
  for (const c of V.counts) {
    it(`countRun: ${c.name}`, () => {
      expect(countRun(c.rows)).toEqual(c.expected);
    });
  }
});

describe("brandRecognised", () => {
  const r = (answer: string | null, named = true, error: string | null = null) => ({ answer, promunch_named: named, error });
  it("knows us when it describes PROMUNCH plainly", () => {
    expect(brandRecognised(r("PROMUNCH sells roasted edamame and soya crunchies online at promunch.in."))).toBe(true);
  });
  it("does not know us when it says it cannot find or verify the brand", () => {
    expect(brandRecognised(r("I don't have reliable information about PROMUNCH."))).toBe(false);
    expect(brandRecognised(r("I could not verify PROMUNCH; it is not a well-known brand."))).toBe(false);
    expect(brandRecognised(r("I'm not familiar with PROMUNCH."))).toBe(false);
    expect(brandRecognised(r("There is limited information about PROMUNCH online."))).toBe(false);
  });
  it("never names us → not recognised; no answer → null", () => {
    expect(brandRecognised(r("That brand sells snacks.", false))).toBe(false);
    expect(brandRecognised(r(null, false, "OpenAI HTTP 500: boom"))).toBeNull();
  });
});

const NOW = Date.parse("2026-10-12T10:00:00Z");

function run(p: Partial<AiVisRunRow> & { id: string; started_at: string }): AiVisRunRow {
  return {
    finished_at: p.started_at,
    heartbeat_at: p.started_at,
    trigger: "cron",
    triggered_by: null,
    status: "done",
    model: "gpt-4.1-mini",
    planned: 3,
    answered: 3,
    errors: 0,
    category_answered: 2,
    named: 0,
    cost_usd: "0.0450",
    error: null,
    ...p,
  };
}

function res(p: Partial<AiVisResultRow> & { prompt_id: string; kind: "category" | "brand" }): AiVisResultRow {
  return {
    prompt_text: `Question ${p.prompt_id}`,
    topic: null,
    model: "gpt-4.1-mini",
    web_search: true,
    answer: "Some answer",
    promunch_named: false,
    promunch_rank: null,
    brands_named: [],
    citations: [],
    error: null,
    cost_usd: 0.015,
    created_at: "2026-10-12T03:36:00Z",
    ...p,
  };
}

const prompts: AiVisPromptRow[] = [
  { id: "p1", key: "audit_protein_snacks", prompt: "Q1", kind: "category", topic: "Protein snacks", active: true, sort: 10 },
  { id: "p2", key: "soya_snacks", prompt: "Q2", kind: "category", topic: "Soya snacks", active: true, sort: 100 },
  { id: "p3", key: "audit_brand_check", prompt: "Q3", kind: "brand", topic: "What AI says about PROMUNCH", active: true, sort: 40 },
  { id: "p4", key: "old", prompt: "Q4", kind: "category", topic: "Old", active: false, sort: 300 },
];

describe("buildAiVisibilitySummary", () => {
  it("empty: no runs yet", () => {
    const s = buildAiVisibilitySummary({ runs: [], results: [], prompts, now: NOW });
    expect(s.latest).toBeNull();
    expect(s.running).toBeNull();
    expect(s.prompts).toEqual([]);
    expect(s.competitors).toEqual([]);
    expect(s.trend).toEqual([]);
    expect(s.active_prompts).toBe(3);
  });

  it("latest finished run: headline counts shopping answers only, rows in prompt order", () => {
    const runs = [
      run({ id: "r2", started_at: "2026-10-12T03:35:00Z", named: 1, category_answered: 2, status: "partial" }),
      run({ id: "r1", started_at: "2026-10-05T03:35:00Z", named: 0, category_answered: 3 }),
      run({ id: "r0", started_at: "2026-09-28T03:35:00Z", status: "failed", named: 0, category_answered: 0 }),
    ];
    const results = [
      res({ prompt_id: "p2", kind: "category", answer: "PROMUNCH and Farmley", promunch_named: true, promunch_rank: 1, brands_named: ["PROMUNCH", "Farmley"] }),
      res({ prompt_id: "p3", kind: "brand", answer: "PROMUNCH sells soya snacks.", promunch_named: true, promunch_rank: 1, brands_named: ["PROMUNCH"] }),
      res({ prompt_id: "p1", kind: "category", answer: "MuscleBlaze, Farmley and Yoga Bar", brands_named: ["MuscleBlaze", "Farmley", "Yoga Bar"] }),
    ];
    const s = buildAiVisibilitySummary({ runs, results, prompts, now: NOW });
    expect(s.latest).toMatchObject({ run_id: "r2", status: "partial", named: 1, total: 2, share: 0.5, errors: 0, cost_usd: 0.045 });
    expect(s.prompts.map((p) => p.prompt_id)).toEqual(["p1", "p3", "p2"]);
    expect(s.prompts[0]).toMatchObject({ from_audit: true, named: false, rank: null, topic: "Protein snacks" });
    expect(s.prompts[1]).toMatchObject({ kind: "brand", recognised: true });
    expect(s.prompts[2]).toMatchObject({ named: true, rank: 1, from_audit: false });
    // failed runs are left out of the trend, oldest first
    expect(s.trend.map((t) => [t.run_id, t.named, t.total, t.share])).toEqual([
      ["r1", 0, 3, 0],
      ["r2", 1, 2, 0.5],
    ]);
  });

  it("a live run shows progress; a stale 'running' row does not", () => {
    const live = run({ id: "rl", started_at: "2026-10-12T09:58:00Z", heartbeat_at: "2026-10-12T09:59:30Z", status: "running", planned: 20 });
    const s = buildAiVisibilitySummary({ runs: [live], results: [], prompts, running_done: 7, now: NOW });
    expect(s.running).toEqual({ run_id: "rl", started_at: live.started_at, planned: 20, done: 7, trigger: "cron" });
    expect(isLive({ ...live, heartbeat_at: "2026-10-12T09:40:00Z" }, NOW)).toBe(false);
  });

  it("errored rows count as errors, never as 'not named'", () => {
    const runs = [run({ id: "r1", started_at: "2026-10-12T03:35:00Z" })];
    const results = [
      res({ prompt_id: "p1", kind: "category", answer: null, error: "OpenAI HTTP 400: tool not supported", web_search: false }),
      res({ prompt_id: "p2", kind: "category", answer: "Farmley", brands_named: ["Farmley"] }),
    ];
    const s = buildAiVisibilitySummary({ runs, results, prompts, now: NOW });
    expect(s.latest).toMatchObject({ named: 0, total: 1, share: 0, errors: 1 });
    expect(s.prompts[0]).toMatchObject({ answered: false, named: false, error: "OpenAI HTTP 400: tool not supported" });
  });
});

describe("shareOfVoice", () => {
  it("counts each brand once per shopping answer, keeps PROMUNCH even at 0, skips brand questions and errors", () => {
    const rows = [
      { kind: "category" as const, error: null, answer: "x", brands_named: ["Farmley", "MuscleBlaze", "Farmley"] },
      { kind: "category" as const, error: null, answer: "x", brands_named: ["Farmley"] },
      { kind: "category" as const, error: "boom", answer: null, brands_named: ["Happilo"] },
      { kind: "brand" as const, error: null, answer: "x", brands_named: ["PROMUNCH", "Yoga Bar"] },
    ];
    expect(shareOfVoice(rows)).toEqual([
      { brand: "Farmley", ours: false, answers: 2, share: 1 },
      { brand: "MuscleBlaze", ours: false, answers: 1, share: 0.5 },
      { brand: "PROMUNCH", ours: true, answers: 0, share: 0 },
    ]);
  });
  it("top 10 competitors plus PROMUNCH", () => {
    const names = Array.from({ length: 14 }, (_, i) => `Brand${String(i).padStart(2, "0")}`);
    const rows = [{ kind: "category" as const, error: null, answer: "x", brands_named: [...names, "PROMUNCH"] }];
    const out = shareOfVoice(rows);
    expect(out).toHaveLength(11);
    expect(out[0]).toMatchObject({ brand: "PROMUNCH", ours: true, answers: 1 });
  });
});
