import { assert, assertEquals } from "jsr:@std/assert";
import {
  buildFeedbackInteractive,
  buildFeedbackPayload,
  buildFeedbackTemplateComponents,
  buildNotHappyMention,
  claimVerdict,
  classifyTapRun,
  FEEDBACK_BUTTON_TITLES,
  FEEDBACK_TEMPLATE_BUTTON_LABELS,
  feedbackAskBody,
  feedbackReplyMarker,
  feedbackReplyText,
  feedbackTemplateVars,
  isFeedbackPayload,
  isRunRef,
  parseFeedbackPayload,
  reviewFeedbackActiveFor,
  reviewTemplateChoice,
} from "./review-feedback.ts";
import { parseGatePayload } from "./cod-gate.ts";
import { parseSupportPayload } from "./quick-replies.ts";

const RUN = "6f1c2a9e-1b2c-4d3e-8f90-0123456789ab";
const URL = "https://promunch.in/pages/review-submission";

Deno.test("payload round-trips for every choice", () => {
  for (const c of ["loved", "okay", "unhappy"] as const) {
    assertEquals(parseFeedbackPayload(buildFeedbackPayload(c, RUN)), { choice: c, ref: RUN });
  }
  assertEquals(parseFeedbackPayload("rvf:loved:#2083"), { choice: "loved", ref: "#2083" });
});

Deno.test("parse rejects malformed / foreign payloads", () => {
  for (const bad of [null, undefined, 42, "", "rvf:", "rvf:loved", "rvf:meh:" + RUN, "rvf:loved:", "RVF:LOVED:x y", `rvf:loved:${"a".repeat(81)}`, "CONFIRM_123", "HELP_TRACK_2083", "Loved it"]) {
    assertEquals(parseFeedbackPayload(bad), null, String(bad));
  }
});

Deno.test("isFeedbackPayload catches the namespace even when malformed", () => {
  assert(isFeedbackPayload("rvf:meh:x"));
  assert(isFeedbackPayload(" RVF:loved:abc"));
  assert(!isFeedbackPayload("CONFIRM_1"));
  assert(!isFeedbackPayload(null));
});

Deno.test("our payloads never collide with the COD gate or support quick replies", () => {
  for (const c of ["loved", "okay", "unhappy"] as const) {
    const p = buildFeedbackPayload(c, RUN);
    assertEquals(parseGatePayload(p), null);
    assertEquals(parseSupportPayload(p), null);
  }
});

Deno.test("isRunRef only accepts a uuid", () => {
  assert(isRunRef(RUN));
  assert(!isRunRef("#2083"));
  assert(!isRunRef("not-a-uuid"));
});

Deno.test("ask body is the approved copy", () => {
  assertEquals(feedbackAskBody("Priya Sharma"), "Hi Priya, it's PROMUNCH! 👋 How are you liking your box?");
  assertEquals(feedbackAskBody(""), "Hi there, it's PROMUNCH! 👋 How are you liking your box?");
});

Deno.test("template components: body name + 3 quick replies in approved order", () => {
  const c = buildFeedbackTemplateComponents("Aarav", RUN) as any[];
  assertEquals(c[0], { type: "body", parameters: [{ type: "text", text: "Aarav" }] });
  assertEquals(c.slice(1).map((b) => [b.type, b.sub_type, b.index, b.parameters[0].payload]), [
    ["button", "quick_reply", "0", `rvf:loved:${RUN}`],
    ["button", "quick_reply", "1", `rvf:okay:${RUN}`],
    ["button", "quick_reply", "2", `rvf:unhappy:${RUN}`],
  ]);
});

Deno.test("interactive ask: approved emoji titles within Meta's 20-char limit", () => {
  const i = buildFeedbackInteractive("Aarav", RUN) as any;
  assertEquals(i.type, "button");
  assertEquals(i.body.text, "Hi Aarav, it's PROMUNCH! 👋 How are you liking your box?");
  assertEquals(i.footer.text, "Your Munchy Pal");
  assertEquals(i.action.buttons.map((b: any) => b.reply.title), ["😍 Loved it", "🙂 It's okay", "😕 Not happy"]);
  assertEquals(i.action.buttons.map((b: any) => b.reply.id), [`rvf:loved:${RUN}`, `rvf:okay:${RUN}`, `rvf:unhappy:${RUN}`]);
  for (const t of Object.values(FEEDBACK_BUTTON_TITLES)) assert([...t].length <= 20, t);
  for (const t of Object.values(FEEDBACK_TEMPLATE_BUTTON_LABELS)) assert(!/\p{Extended_Pictographic}/u.test(t), t);
});

Deno.test("replies are the approved copy, carry the link, no em dashes", () => {
  assertEquals(
    feedbackReplyText("loved", URL),
    `Yay, that made our day! 💚 Could you share it in a quick review? It takes 30 seconds and really helps a small Indian brand: ${URL}`,
  );
  assertEquals(
    feedbackReplyText("okay", URL),
    `Thanks for being honest! What would make it a 😍 for you: taste, crunch, price, or something else? Just reply here, a real person reads every message.\n\nIf you'd like to leave a review, here's the link: ${URL}`,
  );
  assertEquals(
    feedbackReplyText("unhappy", URL),
    `So sorry about that. 😕 Please tell us what went wrong, and add a photo if you can. Our team will sort it out within 24 hours.\n\nYou're always welcome to leave a review too: ${URL}`,
  );
  for (const c of ["loved", "okay", "unhappy"] as const) {
    assert(!feedbackReplyText(c, URL).includes("—"));
    assert(!feedbackReplyText(c, URL).includes("Oltaflock"));
  }
  assert(!feedbackAskBody("A").includes("—"));
});

Deno.test("template vars mirror the body param", () => {
  assertEquals(feedbackTemplateVars("Aarav K"), { "1": "Aarav" });
  assertEquals(feedbackTemplateVars(null), { "1": "there" });
});

Deno.test("reply marker is per ask", () => {
  assertEquals(feedbackReplyMarker(RUN), `review_feedback:${RUN}`);
});

Deno.test("activation: flag off is always off", () => {
  assertEquals(reviewFeedbackActiveFor(false, "919999999999", ""), false);
  assertEquals(reviewFeedbackActiveFor(false, "919999999999", "919999999999"), false);
});

Deno.test("activation: flag on, no allowlist = everyone; allowlist = only those", () => {
  assertEquals(reviewFeedbackActiveFor(true, "919999999999", ""), true);
  assertEquals(reviewFeedbackActiveFor(true, "919999999999", null), true);
  assertEquals(reviewFeedbackActiveFor(true, "919999999999", "+91 99999 99999, 918888888888"), false);
  assertEquals(reviewFeedbackActiveFor(true, "919999999999", "+919999999999,918888888888"), true);
  assertEquals(reviewFeedbackActiveFor(true, null, "918888888888"), false);
});

Deno.test("template choice falls back to legacy unless active AND approved", () => {
  assertEquals(reviewTemplateChoice(false, true), "legacy");
  assertEquals(reviewTemplateChoice(true, false), "legacy");
  assertEquals(reviewTemplateChoice(true, true), "feedback");
});

Deno.test("classifyTapRun", () => {
  assertEquals(classifyTapRun(null, "91"), "unknown_ref");
  assertEquals(classifyTapRun({ wa_id: "919", journey_key: "replenishment_reminder" }, "919"), "wrong_journey");
  assertEquals(classifyTapRun({ wa_id: "918", journey_key: "review_request" }, "919"), "wrong_customer");
  assertEquals(classifyTapRun({ wa_id: null, journey_key: "review_request" }, "919"), "wrong_customer");
  assertEquals(classifyTapRun({ wa_id: "919", journey_key: "review_request" }, "919"), "ok");
});

Deno.test("claimVerdict: only a clean insert wins; any other error sends nothing", () => {
  assertEquals(claimVerdict(null), "won");
  assertEquals(claimVerdict({ code: "23505" }), "duplicate");
  assertEquals(claimVerdict({ code: "42P01" }), "error");
  assertEquals(claimVerdict({ code: null }), "error");
});

Deno.test("Not happy mention: complaint, open case, enriched, linked", () => {
  const now = "2026-10-09T10:00:00.000Z";
  const m = buildNotHappyMention({
    tapWamid: "wamid.X", waId: "919999999999", name: "Priya", orderRef: "#2083",
    runId: RUN, contactId: "c-1", nowIso: now,
  });
  assertEquals(m.source, "whatsapp");
  assertEquals(m.external_id, "wamid.X");
  assertEquals(m.body, "Customer tapped Not happy on the review ask");
  assertEquals(m.rating, null);
  assertEquals(m.sentiment, -2);
  assertEquals(m.urgency, "high");
  assertEquals(m.intent, "complaint");
  assertEquals(m.relevant, true);
  assertEquals(m.enriched_at, now);
  assertEquals(m.case_status, "open");
  assertEquals(m.case_opened_at, now);
  assertEquals(m.contact_id, "c-1");
  assertEquals((m.raw as any).order_ref, "#2083");
  const noContact = buildNotHappyMention({ tapWamid: "w", waId: "91", name: null, orderRef: null, runId: null, contactId: null, nowIso: now });
  assertEquals("contact_id" in noContact, false);
});

Deno.test("review_feedback_v1 definition passes our template rules (as submitted)", async () => {
  const { validateCore, finalFooter } = await import("./template-rules.ts");
  const { FEEDBACK_CHOICES, FEEDBACK_TEMPLATE_BODY, REVIEW_FEEDBACK_FOOTER, REVIEW_FEEDBACK_TEMPLATE } = await import("./review-feedback.ts");
  const issues = validateCore({
    name: REVIEW_FEEDBACK_TEMPLATE,
    category: "MARKETING",
    body: FEEDBACK_TEMPLATE_BODY,
    footer: REVIEW_FEEDBACK_FOOTER,
    buttons: FEEDBACK_CHOICES.map((c) => ({ type: "QUICK_REPLY", text: FEEDBACK_TEMPLATE_BUTTON_LABELS[c] })),
    body_samples: ["Aarav"],
  });
  assertEquals(issues, []);
  assertEquals(finalFooter("MARKETING", REVIEW_FEEDBACK_FOOTER), "Your Munchy Pal · Reply STOP to unsubscribe");
});
