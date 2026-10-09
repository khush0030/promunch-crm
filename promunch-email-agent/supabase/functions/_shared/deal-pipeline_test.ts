import { assertEquals } from "jsr:@std/assert";
import {
  buildTranscript,
  companyDomainOf,
  computeFollowUp,
  extractAddress,
  humanDecisionStands,
  isNoiseSender,
  mergeStage,
  shouldPutOnHold,
  toAiStage,
  toPipelineStage,
} from "./deal-pipeline.ts";
import { parseExtraction } from "./deal-extract.ts";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // fixed clock for determinism

Deno.test("mergeStage ratchets forward, never backwards", () => {
  assertEquals(mergeStage("talking", "negotiating", false), "negotiating");
  assertEquals(mergeStage("negotiating", "talking", false), "negotiating");
  assertEquals(mergeStage("samples", "talking", false), "samples");
});

Deno.test("mergeStage: manual override always wins", () => {
  assertEquals(mergeStage("won", "new", true), "won");
  assertEquals(mergeStage("talking", "won", true), "talking");
});

Deno.test("mergeStage: AI may close a deal; terminal stages stick", () => {
  assertEquals(mergeStage("negotiating", "lost", false), "lost");
  assertEquals(mergeStage("talking", "won", false), "won");
  assertEquals(mergeStage("won", "negotiating", false), "won");
  assertEquals(mergeStage("lost", "talking", false), "lost");
});

Deno.test("mergeStage: any signal revives an on-hold deal", () => {
  assertEquals(mergeStage("on_hold", "new", false), "new");
  assertEquals(mergeStage("on_hold", "negotiating", false), "negotiating");
});

Deno.test("stage mapping: AI / old DB names to pipeline and back", () => {
  assertEquals(toPipelineStage("samples_sent"), "samples");
  assertEquals(toPipelineStage("samples_requested"), "samples");
  assertEquals(toPipelineStage("dormant"), "on_hold");
  assertEquals(toPipelineStage("negotiating"), "negotiating");
  assertEquals(toPipelineStage("???"), "new");
  assertEquals(toAiStage("talking"), "in_discussion");
});

Deno.test("humanDecisionStands until they write in after it", () => {
  assertEquals(humanDecisionStands(null, NOW), false);
  assertEquals(humanDecisionStands(NOW, null), true);
  assertEquals(humanDecisionStands(NOW, NOW - DAY), true);
  assertEquals(humanDecisionStands(NOW - DAY, NOW), false);
});

Deno.test("isNoiseSender flags machine mail, passes humans", () => {
  assertEquals(isNoiseSender("Mail Delivery Subsystem <mailer-daemon@googlemail.com>"), true);
  assertEquals(isNoiseSender("no-reply@zoom.us"), true);
  assertEquals(isNoiseSender("notifications@github.com"), true);
  assertEquals(isNoiseSender("Vikas Sawhney <Vikas.Sawhney@oberoihotels.com>"), false);
  assertEquals(isNoiseSender("harjusk2@gmail.com"), false);
});

Deno.test("extractAddress unwraps display names", () => {
  assertEquals(
    extractAddress("Krunal Pawar <Krunal.Pawar@theleela.com>"),
    "Krunal.Pawar@theleela.com",
  );
  assertEquals(extractAddress("plain@example.com"), "plain@example.com");
});

Deno.test("companyDomainOf: corporate domains yes, freemail no", () => {
  assertEquals(companyDomainOf("a@theleela.com"), "theleela.com");
  assertEquals(companyDomainOf("Harjus <harjusk2@gmail.com>"), null);
  assertEquals(companyDomainOf("not-an-email"), null);
});

Deno.test("computeFollowUp: inbound waiting on our reply", () => {
  const fu = computeFollowUp({
    stage: "talking",
    lastEmailAtMs: NOW - 3 * DAY,
    lastDirection: "inbound",
    samplesSentAtMs: null,
  }, NOW);
  assertEquals(fu.needed, true);
  assertEquals(fu.reason, "Their message has waited 3 days for our reply");
});

Deno.test("computeFollowUp: samples aging beats outbound-nudge rule", () => {
  const fu = computeFollowUp({
    stage: "samples",
    lastEmailAtMs: NOW - 6 * DAY,
    lastDirection: "outbound",
    samplesSentAtMs: NOW - 9 * DAY,
  }, NOW);
  assertEquals(fu.needed, true);
  assertEquals(fu.reason, "Samples sent 9 days ago with no feedback. Nudge them");
});

Deno.test("computeFollowUp: quiet counterparty gets a nudge after 5d", () => {
  const fu = computeFollowUp({
    stage: "negotiating",
    lastEmailAtMs: NOW - 6 * DAY,
    lastDirection: "outbound",
    samplesSentAtMs: null,
  }, NOW);
  assertEquals(fu.needed, true);
  assertEquals(fu.reason, "No reply from them in 6 days. Send a nudge");
});

Deno.test("computeFollowUp: fresh threads and closed deals stay quiet", () => {
  assertEquals(
    computeFollowUp({
      stage: "talking",
      lastEmailAtMs: NOW - DAY,
      lastDirection: "inbound",
      samplesSentAtMs: null,
    }, NOW).needed,
    false,
  );
  assertEquals(
    computeFollowUp({
      stage: "lost",
      lastEmailAtMs: NOW - 30 * DAY,
      lastDirection: "inbound",
      samplesSentAtMs: null,
    }, NOW).needed,
    false,
  );
  assertEquals(
    computeFollowUp({
      stage: "won",
      lastEmailAtMs: NOW - 30 * DAY,
      lastDirection: "outbound",
      samplesSentAtMs: null,
    }, NOW).needed,
    false,
  );
});

Deno.test("computeFollowUp: AI flag is the fallback", () => {
  const fu = computeFollowUp({
    stage: "new",
    lastEmailAtMs: NOW - DAY,
    lastDirection: "outbound",
    samplesSentAtMs: null,
    aiFollowUp: true,
    aiReason: "Expo payment deadline approaching",
  }, NOW);
  assertEquals(fu.needed, true);
  assertEquals(fu.reason, "Expo payment deadline approaching");
});

Deno.test("shouldPutOnHold: 45d of silence, unless pinned, terminal or recently decided", () => {
  assertEquals(shouldPutOnHold("talking", NOW - 50 * DAY, false, NOW), true);
  assertEquals(shouldPutOnHold("talking", NOW - 10 * DAY, false, NOW), false);
  assertEquals(shouldPutOnHold("talking", NOW - 50 * DAY, true, NOW), false);
  assertEquals(shouldPutOnHold("won", NOW - 90 * DAY, false, NOW), false);
  assertEquals(shouldPutOnHold("on_hold", NOW - 90 * DAY, false, NOW), false);
  assertEquals(shouldPutOnHold("talking", NOW - 50 * DAY, false, NOW, NOW - 3 * DAY), false);
});

Deno.test("buildTranscript labels directions and drops the middle of long threads", () => {
  const mk = (i: number, from: string) => ({
    from,
    to: "hello@promunch.in",
    subject: `msg ${i}`,
    dateIso: "2026-07-01",
    body: "x".repeat(1200),
  });
  const msgs = Array.from({ length: 20 }, (_, i) => mk(i, i % 2 ? "hello@promunch.in" : "a@b.com"));
  const t = buildTranscript(msgs, "hello@promunch.in", 8000);
  assertEquals(t.includes("US (PROMUNCH)"), true);
  assertEquals(t.includes("THEM (a@b.com)"), true);
  assertEquals(t.includes("omitted"), true);
  assertEquals(t.length <= 8500, true);
  // head and tail survive
  assertEquals(t.includes("msg 0"), true);
  assertEquals(t.includes("msg 19"), true);
});

Deno.test("parseExtraction: clamps enums, tolerates fences, hard-fails garbage", () => {
  const good = parseExtraction(`\`\`\`json
{"is_deal": true, "company_name": "Oberoi Hotels", "kind": "hotel_hospitality",
 "stage": "negotiation", "confidence": 1.7, "next_step_owner": "us"}
\`\`\``);
  assertEquals(good.is_deal, true);
  assertEquals(good.kind, "hotel_hospitality");
  assertEquals(good.stage, "negotiation");
  assertEquals(good.confidence, 1);
  assertEquals(good.next_step_owner, "us");

  const clamped = parseExtraction(
    `{"is_deal": true, "kind": "spaceship", "stage": "??", "next_step_owner": "aliens"}`,
  );
  assertEquals(clamped.kind, "other");
  assertEquals(clamped.stage, "new_inquiry");
  assertEquals(clamped.next_step_owner, null);

  let threw = false;
  try {
    parseExtraction("sorry, I cannot");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("parseExtraction: relationship read clamps and derives temperature", () => {
  const r = parseExtraction(
    `{"is_deal": true, "willingness": 130, "emotions": ["eager", "curious", "warm", "fast", "extra"],
      "drivers": ["price"], "risks": [], "sentiment": "Pushing hard", "recommended_move": "Send rates"}`,
  );
  assertEquals(r.willingness, 100);
  assertEquals(r.temperature, "hot"); // derived from willingness when absent
  assertEquals(r.emotions.length, 4); // capped
  assertEquals(r.recommended_move, "Send rates");

  const cool = parseExtraction(`{"is_deal": true, "willingness": 10}`);
  assertEquals(cool.temperature, "cool");
  assertEquals(cool.emotions, []);

  const explicit = parseExtraction(`{"is_deal": true, "willingness": 20, "temperature": "warm"}`);
  assertEquals(explicit.temperature, "warm"); // explicit wins over derivation
});
