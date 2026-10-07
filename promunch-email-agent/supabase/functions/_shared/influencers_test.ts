import { assert, assertEquals } from "jsr:@std/assert";
import {
  atIst,
  buildTemplateComponents,
  cleanParam,
  type DealRow,
  dealHealth,
  DEFAULT_SETTINGS,
  deriveReminders,
  digestCounts,
  digestLine,
  inSendWindow,
  istDateKey,
  manualRowKey,
  normalizeSettings,
  sendKindFor,
  toWaId,
} from "./influencers.ts";

const H = 3_600_000;
const D = 86_400_000;
// 2026-10-07 06:30 UTC = 12:00 IST
const NOW = Date.UTC(2026, 9, 7, 6, 30);
const iso = (t: number) => new Date(t).toISOString();
const S = DEFAULT_SETTINGS;
const CTX = { briefVersion: 1, latestDraftVersion: null, latestDraftSubmittedAt: null };

function deal(p: Partial<DealRow>): DealRow {
  return {
    id: "d1", influencer_id: "i1", code: "abc123def456", stage: "agreed",
    agreed_at: iso(NOW - 2 * H), brief_sent_at: null, brief_acknowledged_at: null, dispatched_at: null,
    delivered_at: null, draft_due_at: null, draft_submitted_at: null, draft_approved_at: null, go_live_at: null,
    posted_at: null, revision_count: 0, ...p,
  };
}
const keys = (rs: { kind: string; step: number }[]) => rs.map((r) => `${r.kind}#${r.step}`).sort();

Deno.test("closed deals derive nothing", () => {
  for (const stage of ["completed", "cancelled", "ghosted"] as const) {
    assertEquals(deriveReminders(deal({ stage }), S, NOW, CTX), []);
  }
});

Deno.test("brief_sent: two ack nudges namespaced by brief version + owner escalation at 72h", () => {
  const r = deriveReminders(deal({ stage: "brief_sent", brief_sent_at: iso(NOW - 2 * H) }), S, NOW, {
    ...CTX,
    briefVersion: 2,
  });
  assertEquals(keys(r), ["brief_ack#21", "brief_ack#22", "escalation#102"]);
  const esc = r.find((x) => x.kind === "escalation")!;
  assertEquals(esc.audience, "owner");
  assertEquals(Date.parse(esc.due_at), NOW - 2 * H + 72 * H);
  assertEquals(r.find((x) => x.step === 21)!.template_name, "influencer_brief_reminder");
});

Deno.test("derivation is deterministic (idempotent re-arm)", () => {
  const d = deal({ stage: "brief_sent", brief_sent_at: iso(NOW - 2 * H) });
  assertEquals(deriveReminders(d, S, NOW, CTX), deriveReminders(d, S, NOW + 15 * 60_000, CTX));
});

Deno.test("never two catch-up nudges: only the latest past step is kept", () => {
  // sent 50h ago: both +24h and +48h are past → only +48h (step 12) kept
  const r = deriveReminders(deal({ stage: "brief_sent", brief_sent_at: iso(NOW - 50 * H) }), S, NOW, CTX);
  assertEquals(keys(r.filter((x) => x.audience === "creator")), ["brief_ack#12"]);
});

Deno.test("stale creator nudges are dropped entirely", () => {
  // sent 100h ago: +48h step is 52h stale (> 36h) → no creator nudge, escalation remains
  const r = deriveReminders(deal({ stage: "brief_sent", brief_sent_at: iso(NOW - 100 * H) }), S, NOW, CTX);
  assertEquals(keys(r), ["escalation#101"]);
});

Deno.test("acknowledged brief cancels ack gate (not derived) and arms team_dispatch #2", () => {
  const r = deriveReminders(
    deal({ stage: "brief_acknowledged", brief_sent_at: iso(NOW - 30 * H), brief_acknowledged_at: iso(NOW - H) }),
    S,
    NOW,
    CTX,
  );
  assertEquals(keys(r), ["team_dispatch#2"]);
  assertEquals(Date.parse(r[0].due_at), NOW - H + 48 * H);
});

Deno.test("dispatched: box checks at +4d/+6d 10:00 IST, escalation +8d", () => {
  const r = deriveReminders(deal({ stage: "dispatched", dispatched_at: iso(NOW) }), S, NOW, CTX);
  assertEquals(keys(r), ["delivery_check#1", "delivery_check#2", "escalation#200"]);
  const s1 = r.find((x) => x.kind === "delivery_check" && x.step === 1)!;
  assertEquals(s1.due_at, iso(atIst(NOW, 4, 10)));
  assertEquals(istDateKey(Date.parse(s1.due_at)), "2026-10-11");
  assertEquals(s1.template_name, "influencer_box_check");
});

Deno.test("delivered: draft reminders before due + overdue steps after + escalation", () => {
  const due = atIst(NOW, 5, 23, 59);
  const r = deriveReminders(deal({ stage: "delivered", delivered_at: iso(NOW), draft_due_at: iso(due) }), S, NOW, CTX);
  assertEquals(keys(r), ["draft_due#1", "draft_due#11", "draft_due#12", "draft_due#2", "escalation#300"]);
  assertEquals(sendKindFor("draft_due", 2), "draft_reminder");
  assertEquals(sendKindFor("draft_due", 11), "draft_overdue");
  // due-day reminder is never after the deadline itself
  const dueDay = r.find((x) => x.kind === "draft_due" && x.step === 2)!;
  assert(Date.parse(dueDay.due_at) < due);
});

Deno.test("submitted draft: no creator draft nudges, team review task keyed by draft version", () => {
  const sub = iso(NOW - 3 * H);
  const r = deriveReminders(
    deal({ stage: "draft_submitted", draft_due_at: iso(NOW + D), draft_submitted_at: sub }),
    S,
    NOW,
    { ...CTX, latestDraftVersion: 3, latestDraftSubmittedAt: sub },
  );
  assertEquals(keys(r), ["team_draft_review#3"]);
  assertEquals(r[0].channel, "task");
});

Deno.test("draft_approved with go-live: post reminder the day before", () => {
  const goLive = NOW + 3 * D;
  const r = deriveReminders(deal({ stage: "draft_approved", go_live_at: iso(goLive) }), S, NOW, CTX);
  assertEquals(keys(r), ["post_due#1"]);
  assertEquals(r[0].due_at, iso(atIst(goLive, -1, 10)));
});

Deno.test("agreed: brief approval + dispatch SLA team tasks", () => {
  const r = deriveReminders(deal({ stage: "agreed" }), S, NOW, CTX);
  assertEquals(keys(r), ["team_brief_approval#1", "team_dispatch#1"]);
  assert(r.every((x) => x.audience === "team" && x.channel === "task"));
});

Deno.test("manual keys: brief_ready=brief version, draft_feedback=draft version, others once per IST day", () => {
  assertEquals(manualRowKey("brief_ready", { briefVersion: 2, draftVersion: null, now: NOW }), {
    kind: "brief_ready",
    step: 2,
  });
  assertEquals(manualRowKey("draft_feedback", { briefVersion: null, draftVersion: 4, now: NOW }), {
    kind: "draft_feedback",
    step: 4,
  });
  assert("error" in manualRowKey("brief_ready", { briefVersion: null, draftVersion: null, now: NOW }));
  const a = manualRowKey("box_check", { briefVersion: null, draftVersion: null, now: NOW });
  const b = manualRowKey("box_check", { briefVersion: null, draftVersion: null, now: NOW + 5 * H });
  const c = manualRowKey("box_check", { briefVersion: null, draftVersion: null, now: NOW + 13 * H });
  assertEquals(a, b); // same IST day → same row → second click is a no-op
  assert(JSON.stringify(a) !== JSON.stringify(c)); // 01:00 IST next day
  assertEquals(sendKindFor("manual_box_check", 1), "box_check");
});

Deno.test("template components: body params + URL button = deal code; no em dashes or newlines", () => {
  const t = buildTemplateComponents("post_fix", {
    influencer: { full_name: "Priya Sharma", handle: "priya" },
    deal: deal({}),
    meta: { note: "Tag @promunch.snacks — and\nadd #ad" },
  });
  assertEquals(t.name, "influencer_post_fix");
  assertEquals(t.components[0].parameters[0].text, "Priya");
  assert(!/[—\n]/.test(t.components[0].parameters[1].text));
  assertEquals(t.components[1], {
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text: "abc123def456" }],
  });
  assertEquals(t.vars["1"], "Priya");
});

Deno.test("draft_feedback variants", () => {
  const ctx = (decision: string, go?: string) => ({
    influencer: { full_name: null, handle: "@rahul" },
    deal: deal({ go_live_at: go ?? null }),
    meta: { decision },
  });
  assertEquals(
    buildTemplateComponents("draft_feedback", ctx("approved", iso(NOW + 2 * D))).vars["2"],
    "your draft is approved, please post it on 9 Oct",
  );
  assertEquals(buildTemplateComponents("draft_feedback", ctx("changes_requested")).vars["2"], "we have a few small changes for you");
  assertEquals(buildTemplateComponents("draft_feedback", ctx("approved")).vars["1"], "rahul");
});

Deno.test("health + digest", () => {
  const deals = [
    { ...deal({ id: "a", stage: "delivered", draft_due_at: iso(NOW - 4 * D) }), handle: "a" },
    { ...deal({ id: "b", stage: "delivered", draft_due_at: iso(NOW - 2 * H) }), handle: "b" },
    { ...deal({ id: "c", stage: "draft_submitted", draft_submitted_at: iso(NOW - 2 * H) }), handle: "c" },
    { ...deal({ id: "e", stage: "brief_acknowledged", brief_acknowledged_at: iso(NOW - H) }), handle: "e" },
    { ...deal({ id: "f", stage: "brief_draft" }), handle: "f" },
    { ...deal({ id: "g", stage: "delivered", draft_due_at: iso(atIst(NOW, 0, 22)) }), handle: "g" },
  ];
  assertEquals(dealHealth(deals[0], S, NOW).health, "overdue");
  assertEquals(dealHealth(deals[5], S, NOW).health, "at_risk");
  const c = digestCounts(deals, new Set(["f"]), S, NOW);
  assertEquals(c.overdue_list, ["@a 4d", "@b 1d"]);
  assertEquals(c.due_today, 2); // b (due earlier today, so also overdue) + g
  assertEquals(c.drafts_to_review, 1);
  assertEquals(c.kits_to_ship, 1);
  assertEquals(c.briefs_to_approve, 1);
  assert(digestLine(c).startsWith("Due today"));
  assert(!digestLine(c).includes("—"));
});

Deno.test("helpers", () => {
  assertEquals(toWaId("98765 43210"), "919876543210");
  assertEquals(toWaId("+91 98765-43210"), "919876543210");
  assertEquals(toWaId("123"), null);
  assertEquals(cleanParam("a\n\nb  —  c"), "a b , c");
  assert(inSendWindow(NOW)); // 12:00 IST
  assert(!inSendWindow(Date.UTC(2026, 9, 7, 17, 0))); // 22:30 IST
  const s = normalizeSettings({ engine_enabled: true, nudges: { brief_ack: { after_hours: [12] } } });
  assertEquals(s.nudges.brief_ack.after_hours, [12]);
  assertEquals(s.nudges.brief_ack.escalate_after_hours, 72);
  assertEquals(s.nudges.draft_due.days_after_due, [1, 3]);
  assertEquals(normalizeSettings(null).engine_enabled, false);
});
