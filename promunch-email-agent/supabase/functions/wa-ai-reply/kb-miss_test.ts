// Guards the knowledge-gap classifier against the two ways it can go wrong:
// missing a real gap (the audit finding it exists to catch) and flagging a
// designed script as a gap (which would bury the real ones in noise).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isKbMiss } from "./kb-miss.ts";

const GAPS = [
  "I don't have the exact price details for that. I've noted this and the team will confirm.",
  "I'm not sure about that one, let me check with the team.",
  "I can't find any information on that flavour.",
];

const BY_DESIGN = [
  // wholesale / bulk intake: correctly says we have no retail bulk pack, then collects the lead
  "We do not offer a 1 kg or bulk retail pack right now. If you need bulk or institutional supply, let me know your business name, city, and rough quantity per month.",
  // answered from the live catalogue
  "The PROMUNCH Rakhi Gift Hamper was Rs 555 but it is currently sold out. If you want something similar, I can suggest a combo.",
  "Thanks for sharing your details. The sales team will call you back within support hours.",
  "Sorry about this. The quality team will contact you personally.",
  "Please email hello@promunch.in with your profile and reach.",
  // says no, but names what we DO sell: a complete answer
  "We do not sell protein powder or shakes. Our snacks are all plant-protein based, like roasted edamame and soya crunchies.",
  "Soya Crunchies have 15.2 g protein per 30 g pack.",
];

Deno.test("flags a genuine knowledge gap", () => {
  for (const r of GAPS) assertEquals(isKbMiss(r, false), true, r);
});

Deno.test("does not flag a designed script or a real answer", () => {
  for (const r of BY_DESIGN) assertEquals(isKbMiss(r, false), false, r);
});

Deno.test("a raised ticket is a handled outcome, not a gap", () => {
  assertEquals(isKbMiss(GAPS[0], true), false);
});
