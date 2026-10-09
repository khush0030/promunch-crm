import { assertEquals } from "jsr:@std/assert";
import { computeScore, type ScoreMention, scoreBand } from "./orm-score.ts";

// Shared with the Next.js copy (src/lib/orm/score.ts): same file, same answers.
const VECTORS_URL = new URL("../../../../docs/plans/orm-score-vectors.json", import.meta.url);
const vectors = JSON.parse(await Deno.readTextFile(VECTORS_URL)) as {
  vectors: Array<{ name: string; mentions: ScoreMention[]; expected: unknown; band: string | null }>;
  bands: Array<{ score: number | null; band: string | null }>;
};

for (const v of vectors.vectors) {
  Deno.test(`score vector: ${v.name}`, () => {
    const got = computeScore(v.mentions);
    assertEquals(got, v.expected);
    assertEquals(scoreBand(got.score), v.band);
  });
}

Deno.test("score bands", () => {
  for (const b of vectors.bands) assertEquals(scoreBand(b.score), b.band, String(b.score));
});

Deno.test("vectors file covers empty, one 5 star and the mixed fixture", () => {
  const names = vectors.vectors.map((v) => v.name);
  for (const n of ["empty", "one 5 star positive", "mixed fixture"]) assertEquals(names.includes(n), true, n);
});
