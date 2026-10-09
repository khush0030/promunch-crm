import { assertEquals } from "jsr:@std/assert@1";
import { applyAccountKind, applyAudience, BRAND_FIT_CAP, compositeFit, FOREIGN_FIT_CAP } from "./ig-scoring.ts";

Deno.test("brand accounts are capped below creators", () => {
  const fit = compositeFit(5000, 0.1, 20, 1000, 15000);
  assertEquals(applyAccountKind(fit, "brand"), BRAND_FIT_CAP);
  assertEquals(applyAccountKind(fit, "creator"), fit);
  assertEquals(applyAccountKind(fit, null), fit);
  assertEquals(applyAccountKind(10, "brand"), 10);
});

Deno.test("non-Indian audiences are capped; unknown is left alone", () => {
  assertEquals(applyAudience(70, "no"), FOREIGN_FIT_CAP);
  assertEquals(applyAudience(70, "yes"), 70);
  assertEquals(applyAudience(70, "unknown"), 70);
});
