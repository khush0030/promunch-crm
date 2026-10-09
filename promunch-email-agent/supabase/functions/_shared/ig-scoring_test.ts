import { assertEquals } from "jsr:@std/assert@1";
import { applyAccountKind, BRAND_FIT_CAP, compositeFit } from "./ig-scoring.ts";

Deno.test("brand accounts are capped below creators", () => {
  const fit = compositeFit(5000, 0.1, 20, 1000, 15000);
  assertEquals(applyAccountKind(fit, "brand"), BRAND_FIT_CAP);
  assertEquals(applyAccountKind(fit, "creator"), fit);
  assertEquals(applyAccountKind(fit, null), fit);
  assertEquals(applyAccountKind(10, "brand"), 10);
});
