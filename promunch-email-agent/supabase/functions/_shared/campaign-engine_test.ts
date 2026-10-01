// Run: deno test supabase/functions/_shared/campaign-engine_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allowedPriorStatuses,
  budgetResumeAt,
  buildTemplateComponents,
  classifySendError,
  classifySyncFailure,
  contactVerdict,
  contentChanged,
  FOLLOWUP_LIFETIME_MS,
  followupFilterError,
  followupFinish,
  followupGate,
  inQuietHours,
  istDay,
  istDayStartMs,
  istMinuteOfDay,
  mediaKindFromUrl,
  rowClass,
  nextAllowedAt,
  nextWaveAt,
  shouldTripBreaker,
  validateCampaignSetup,
  waveMinute,
} from "./campaign-engine.ts";

// IST wall-clock → epoch ms
const ist = (y: number, mo: number, d: number, h: number, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) - 5.5 * 3600_000;

Deno.test("classify: cap, optout, terminal are distinct", () => {
  assertEquals(classifySendError(131049, null), "cap");
  assertEquals(classifySendError(131050, null), "optout");
  assertEquals(classifySendError(131026, null), "terminal");
  assertEquals(classifySendError(130472, null), "terminal");
  assertEquals(classifySendError(null, "This message was not delivered to maintain healthy ecosystem engagement."), "cap");
});

Deno.test("classify: structural errors (template/params/auth/account)", () => {
  for (const c of [132000, 132001, 132012, 132015, 132016, 190, 1, 10, 200, 131031, 131042, 368, 100, 131008]) {
    assertEquals(classifySendError(c, null), "structural", `code ${c}`);
  }
  assertEquals(classifySendError("132012", "Parameter format does not match"), "structural");
});

Deno.test("classify: transient errors", () => {
  for (const c of [131000, 131016, 130429, 131056, 80007]) {
    assertEquals(classifySendError(c, null), "transient", `code ${c}`);
  }
  assertEquals(classifySendError(null, "TypeError: fetch failed"), "transient");
  assertEquals(classifySendError(null, "HTTP 503"), "transient");
});

Deno.test("classify: stale claims are ambiguous, unknowns are unknown", () => {
  assertEquals(classifySendError(null, "stale claim reclaimed"), "ambiguous");
  assertEquals(classifySendError(null, "ambiguous: sender died mid-send"), "ambiguous");
  assertEquals(classifySendError(999999, "weird"), "unknown");
  assertEquals(classifySendError(null, "something odd"), "unknown");
});

Deno.test("verdict: any successful row = reached, never messaged again", () => {
  const today = ist(2026, 9, 29, 0);
  assertEquals(contactVerdict([{ status: "failed", error: "x", created_at: new Date(today).toISOString() }, {
    status: "delivered",
    created_at: new Date(today).toISOString(),
  }], today).kind, "reached");
  assertEquals(contactVerdict([{ status: "queued", created_at: new Date(today).toISOString() }], today).kind, "in_flight");
  assertEquals(contactVerdict([], today).kind, "fresh");
});

Deno.test("verdict: structural failures are retryable immediately; cap waits a day", () => {
  const today = ist(2026, 9, 29, 0);
  const at = new Date(today + 3600_000).toISOString();
  const s = contactVerdict([{ status: "failed", error_class: "structural", created_at: at }], today);
  assertEquals(s, { kind: "retry", waitNextDay: false, attempts: 1 });
  const c = contactVerdict([{ status: "failed", error_class: "cap", created_at: at }], today);
  assertEquals(c, { kind: "retry", waitNextDay: true, attempts: 1 });
  const yesterday = new Date(today - 3600_000).toISOString();
  assertEquals(contactVerdict([{ status: "failed", error_class: "cap", created_at: yesterday }], today).kind, "retry");
  assertEquals(
    (contactVerdict([{ status: "failed", error_class: "cap", created_at: yesterday }], today) as { waitNextDay: boolean })
      .waitNextDay,
    false,
  );
});

Deno.test("verdict: terminal / optout / ambiguous / exhausted are done", () => {
  const today = ist(2026, 9, 29, 0);
  const at = new Date(today - 5 * 86400_000).toISOString();
  assertEquals(contactVerdict([{ status: "failed", code: 131026, created_at: at }], today), {
    kind: "done",
    reason: "terminal",
  });
  assertEquals(contactVerdict([{ status: "failed", error_class: "optout", created_at: at }], today), {
    kind: "done",
    reason: "optout",
  });
  assertEquals(contactVerdict([{ status: "failed", error: "stale claim reclaimed", created_at: at }], today), {
    kind: "done",
    reason: "ambiguous",
  });
  const three = Array.from({ length: 3 }, () => ({ status: "failed", error_class: "transient", created_at: at }));
  assertEquals(contactVerdict(three, today), { kind: "done", reason: "transient_exhausted" });
  const twoT = three.slice(0, 2);
  assertEquals(contactVerdict(twoT, today).kind, "retry");
});

Deno.test("breaker: only structural, only with zero sends", () => {
  assertEquals(shouldTripBreaker({ sent: 0, structural: 5, attempted: 50 }), true);
  assertEquals(shouldTripBreaker({ sent: 0, structural: 2, attempted: 2 }), true);
  assertEquals(shouldTripBreaker({ sent: 0, structural: 2, attempted: 50 }), false);
  assertEquals(shouldTripBreaker({ sent: 1, structural: 49, attempted: 50 }), false);
  assertEquals(shouldTripBreaker({ sent: 0, structural: 0, attempted: 50 }), false); // all cap / terminal
});

Deno.test("pacing: IST day + quiet hours", () => {
  assertEquals(istDay(ist(2026, 9, 29, 0, 5)), "2026-09-29");
  assertEquals(istDay(ist(2026, 9, 28, 23, 59)), "2026-09-28");
  assertEquals(istMinuteOfDay(ist(2026, 9, 29, 13, 30)), 13 * 60 + 30);
  assert(inQuietHours(ist(2026, 9, 29, 21, 0)));
  assert(inQuietHours(ist(2026, 9, 29, 8, 59)));
  assert(!inQuietHours(ist(2026, 9, 29, 9, 0)));
  assert(!inQuietHours(ist(2026, 9, 29, 20, 59)));
});

Deno.test("pacing: nextAllowedAt jumps out of quiet hours to the wave time", () => {
  assertEquals(nextAllowedAt(ist(2026, 9, 29, 14, 0), 600), ist(2026, 9, 29, 14, 0));
  assertEquals(nextAllowedAt(ist(2026, 9, 29, 22, 0), 600), ist(2026, 9, 30, 10, 0));
  assertEquals(nextAllowedAt(ist(2026, 9, 30, 3, 0), 18 * 60), ist(2026, 9, 30, 18, 0));
});

Deno.test("pacing: next wave respects the campaign's time-of-day, not a fixed noon", () => {
  const wm = waveMinute(new Date(ist(2026, 9, 28, 18, 30)).toISOString(), null);
  assertEquals(wm, 18 * 60 + 30);
  assertEquals(nextWaveAt(ist(2026, 9, 29, 19, 0), wm), ist(2026, 9, 30, 18, 30));
  // scheduled inside quiet hours → default 10:00
  assertEquals(waveMinute(new Date(ist(2026, 9, 28, 23, 0)).toISOString(), null), 600);
});

Deno.test("pacing: budget resume = oldest counted send + 24h (+margin), not tomorrow noon", () => {
  const now = ist(2026, 9, 29, 15, 0);
  const oldest = ist(2026, 9, 28, 16, 0);
  const r = budgetResumeAt(now, oldest, 600);
  assertEquals(r, ist(2026, 9, 29, 16, 5)); // same day, no skipped day
  // frees at 23:00 → pushed to next morning's wave time
  assertEquals(budgetResumeAt(now, ist(2026, 9, 28, 23, 0), 600), ist(2026, 9, 30, 10, 0));
  // unknown oldest → next daily wave
  assertEquals(budgetResumeAt(now, null, 600), ist(2026, 9, 30, 10, 0));
});

const IMG_TPL = {
  name: "promo_img",
  header_type: "IMAGE",
  header_media_url: "https://cdn.example.com/a.jpg",
  body: "Hi {{1}}, try {{2}}",
  buttons: [
    { type: "QUICK_REPLY", text: "Stop promotions" },
    { type: "URL", text: "Shop", url: "https://promunch.in/{{1}}", example: "https://promunch.in/collections/all" },
  ],
};

Deno.test("builder: header media override replaces the template image", () => {
  const { components, errors } = buildTemplateComponents(IMG_TPL, {
    vars: { "1": "{name}", "2": "Crunchies" },
    contactName: "Asha",
    headerMediaOverride: "https://cdn.example.com/diwali.png",
  });
  assertEquals(errors, []);
  assertEquals(components[0], {
    type: "header",
    parameters: [{ type: "image", image: { link: "https://cdn.example.com/diwali.png" } }],
  });
  assertEquals(components[1].parameters, [{ type: "text", text: "Asha" }, { type: "text", text: "Crunchies" }]);
});

Deno.test("builder: override type must match template header format", () => {
  const { errors } = buildTemplateComponents(IMG_TPL, {
    vars: { "1": "a", "2": "b" },
    headerMediaOverride: "https://cdn.example.com/clip.mp4",
  });
  assert(errors.some((e) => e.includes("video")));
  assertEquals(mediaKindFromUrl("https://x/y.JPG?v=1"), "IMAGE");
  assertEquals(mediaKindFromUrl("https://x/y"), null);
});

Deno.test("builder: dynamic URL button filled from _button_<i>, else sample suffix; index = template position", () => {
  const a = buildTemplateComponents(IMG_TPL, { vars: { "1": "a", "2": "b", _button_1: "products/crunchies" } });
  const btn = a.components.find((c) => c.type === "button")!;
  assertEquals(btn.index, "1");
  assertEquals(btn.parameters, [{ type: "text", text: "products/crunchies" }]);
  const b = buildTemplateComponents(IMG_TPL, { vars: { "1": "a", "2": "b" } });
  assertEquals(b.components.find((c) => c.type === "button")!.parameters, [{ type: "text", text: "collections/all" }]);
  // full URL given → base stripped
  const c = buildTemplateComponents(IMG_TPL, {
    vars: { "1": "a", "2": "b", _button_1: "https://promunch.in/pages/x" },
  });
  assertEquals(c.components.find((x) => x.type === "button")!.parameters, [{ type: "text", text: "pages/x" }]);
  // tracked code wins
  const d = buildTemplateComponents(IMG_TPL, { vars: { "1": "a", "2": "b" }, trackedCodes: { 1: "Ab12Cd34" } });
  assertEquals(d.components.find((x) => x.type === "button")!.parameters, [{ type: "text", text: "Ab12Cd34" }]);
});

Deno.test("builder: UTM tagging keeps the base intact", () => {
  const { components } = buildTemplateComponents(IMG_TPL, {
    vars: { "1": "a", "2": "b", _button_1: "collections/all" },
    tagUrl: (u) => u + "?utm_source=whatsapp",
  });
  assertEquals(components.find((x) => x.type === "button")!.parameters, [{
    type: "text",
    text: "collections/all?utm_source=whatsapp",
  }]);
});

Deno.test("builder: header text variable from _header_1; missing params are errors", () => {
  const tpl = { header_type: "TEXT", header_text: "Sale: {{1}}", body: "Hello {{1}}" };
  const ok = buildTemplateComponents(tpl, { vars: { _header_1: "Diwali", "1": "x" } });
  assertEquals(ok.errors, []);
  assertEquals(ok.components[0], { type: "header", parameters: [{ type: "text", text: "Diwali" }] });
  const bad = buildTemplateComponents(tpl, { vars: {} });
  assertEquals(bad.errors.length, 2);
});

Deno.test("validate: empty AI brief is rejected; AI brief skips body check", () => {
  const tpl = { body: "Hi {{1}}" };
  assert(validateCampaignSetup(tpl, { _ai_brief: "  " }, null).some((e) => e.includes("brief")));
  assertEquals(validateCampaignSetup(tpl, { _ai_brief: "Diwali offer" }, null), []);
  assert(validateCampaignSetup(tpl, {}, null).length > 0);
  assert(validateCampaignSetup({ body: "no vars" }, {}, "https://x/a.jpg").length > 0); // no media header
});

Deno.test("status monotonic: never regress, failed only over queued/sent", () => {
  assertEquals(allowedPriorStatuses("delivered"), ["queued", "sent"]);
  assert(!allowedPriorStatuses("sent").includes("delivered"));
  assert(!allowedPriorStatuses("failed").includes("delivered"));
  assert(!allowedPriorStatuses("failed").includes("read"));
  assert(allowedPriorStatuses("read").includes("delivered"));
  assertEquals(allowedPriorStatuses("received"), []);
});

Deno.test("sync failure without a Meta code is ambiguous (possible accept), never transient", () => {
  assertEquals(classifySyncFailure(undefined, "TypeError: fetch failed"), "ambiguous");
  assertEquals(classifySyncFailure(null, "HTTP 502"), "ambiguous");
  // 131000 / 2 are Meta-side faults, not refusals: outcome unknown.
  assertEquals(classifySyncFailure(131000, "Something went wrong"), "ambiguous");
  assertEquals(classifySyncFailure(2, "Service temporarily unavailable"), "ambiguous");
  assertEquals(classifySyncFailure(132012, "Parameter format"), "structural");
});

Deno.test("short-link (/r/{{1}}) button: tracked code required, sample never used", () => {
  const tpl = {
    body: "hi",
    buttons: [{ type: "URL", text: "Shop", url: "https://crm.example.com/r/{{1}}", example: "https://crm.example.com/r/abc" }],
  };
  assertEquals(validateCampaignSetup(tpl, { _track_url: "https://promunch.in/x" }, null), []);
  assert(validateCampaignSetup(tpl, {}, null).some((e) => e.includes("_track_url")));
  const sendTime = buildTemplateComponents(tpl, { vars: { _track_url: "https://promunch.in/x" } });
  assert(sendTime.errors.length === 1); // mint failed → error, not a dead link
  const ok = buildTemplateComponents(tpl, { vars: { _track_url: "https://promunch.in/x" }, trackedCodes: { 0: "Zz9" } });
  assertEquals(ok.errors, []);
});

// ---------------------------------------------------------------------------
// Review pass additions
// ---------------------------------------------------------------------------

Deno.test("sync failure: HTTP 5xx is ambiguous whatever the code; 4xx keeps its class", () => {
  assertEquals(classifySyncFailure(1, "An unknown error occurred", 500), "ambiguous");
  assertEquals(classifySyncFailure(131049, "ecosystem", 503), "ambiguous");
  assertEquals(classifySyncFailure(1, "An unknown error occurred", 400), "structural");
  assertEquals(classifySyncFailure(190, "token expired", 401), "structural");
  assertEquals(classifySyncFailure(131049, "healthy ecosystem", 400), "cap");
  assertEquals(classifySyncFailure(130429, "rate limit", 429), "transient");
  assertEquals(classifySyncFailure(131026, "undeliverable", 400), "terminal");
});

Deno.test("legacy rows without class/code: network-shaped errors are ambiguous, never retried", () => {
  const at = new Date(ist(2026, 9, 28, 12)).toISOString();
  assertEquals(rowClass({ status: "failed", error: "TypeError: fetch failed", created_at: at }), "ambiguous");
  assertEquals(rowClass({ status: "failed", error: "HTTP 502", created_at: at }), "ambiguous");
  assertEquals(rowClass({ status: "failed", error: "healthy ecosystem engagement", created_at: at }), "cap");
  const v = contactVerdict([{ status: "failed", error: "fetch failed", created_at: at }], ist(2026, 9, 29, 0));
  assertEquals(v, { kind: "done", reason: "ambiguous" });
  // a stored class always wins over text
  assertEquals(rowClass({ status: "failed", error: "fetch failed", error_class: "transient", created_at: at }), "transient");
});

Deno.test("verdict: a failed-after-sent row never makes a reached contact eligible again", () => {
  const today = ist(2026, 9, 29, 0);
  const at = new Date(today + 3600_000).toISOString();
  // two rows: one async-failed, one sent (e.g. an earlier retry that landed)
  assertEquals(
    contactVerdict([
      { status: "failed", error_class: "cap", created_at: at },
      { status: "sent", created_at: at },
    ], today).kind,
    "reached",
  );
  // ambiguous anywhere = done, even alongside retryable classes
  assertEquals(
    contactVerdict([
      { status: "failed", error_class: "transient", created_at: at },
      { status: "failed", error_class: "ambiguous", created_at: at },
    ], today),
    { kind: "done", reason: "ambiguous" },
  );
});

Deno.test("pacing: campaign scheduled at 20:55 IST sends later waves at 10:00, not 20:55", () => {
  const wm = waveMinute(new Date(ist(2026, 9, 29, 20, 55)).toISOString(), null);
  assertEquals(wm, 600);
  // quiet hours start at 21:00 → the batch parks until the next morning's wave
  assert(!inQuietHours(ist(2026, 9, 29, 20, 55)));
  assert(inQuietHours(ist(2026, 9, 29, 21, 0)));
  assertEquals(nextAllowedAt(ist(2026, 9, 29, 21, 1), wm), ist(2026, 9, 30, 10, 0));
  // a 19:00 campaign keeps its time (two sending hours before quiet hours)
  assertEquals(waveMinute(new Date(ist(2026, 9, 29, 19, 0)).toISOString(), null), 19 * 60);
  assertEquals(waveMinute(new Date(ist(2026, 9, 29, 19, 1)).toISOString(), null), 600);
  // 09:00 exactly is allowed; 08:59 falls back
  assertEquals(waveMinute(new Date(ist(2026, 9, 29, 9, 0)).toISOString(), null), 540);
  assertEquals(waveMinute(new Date(ist(2026, 9, 29, 8, 59)).toISOString(), null), 600);
});

Deno.test("pacing: midnight crossing uses the IST day, not the UTC day", () => {
  // 00:30 IST on Sep 30 is 19:00 UTC on Sep 29
  const t = ist(2026, 9, 30, 0, 30);
  assertEquals(new Date(t).toISOString().slice(0, 10), "2026-09-29");
  assertEquals(istDay(t), "2026-09-30");
  assertEquals(istDayStartMs(t), ist(2026, 9, 30, 0, 0));
  assert(inQuietHours(t));
  // same IST morning, not the day after
  assertEquals(nextAllowedAt(t, 600), ist(2026, 9, 30, 10, 0));
  // 23:59:59.999 IST belongs to the same IST day; 00:00 is the next
  assertEquals(istDay(ist(2026, 9, 29, 0, 0) + 24 * 3600_000 - 1), "2026-09-29");
  assertEquals(istDay(ist(2026, 9, 30, 0, 0)), "2026-09-30");
  // next wave from 23:30 IST = tomorrow's wave (Sep 30), not two days out
  assertEquals(nextWaveAt(ist(2026, 9, 29, 23, 30), 600), ist(2026, 9, 30, 10, 0));
});

Deno.test("pacing: quiet-hour boundaries 09:00 and 21:00 IST", () => {
  assert(inQuietHours(ist(2026, 9, 29, 8, 59)));
  assert(!inQuietHours(ist(2026, 9, 29, 9, 0)));
  assert(!inQuietHours(ist(2026, 9, 29, 20, 59)));
  assert(inQuietHours(ist(2026, 9, 29, 21, 0)));
});

Deno.test("pacing: rolling-24h budget resume lands outside quiet hours and never in the past", () => {
  const now = ist(2026, 9, 29, 15, 0);
  // oldest counted send at 20:58 yesterday → frees 21:03 today → quiet → tomorrow 10:00
  assertEquals(budgetResumeAt(now, ist(2026, 9, 28, 20, 58), 600), ist(2026, 9, 30, 10, 0));
  // oldest already aged out (stale data) → at least a minute from now, in hours
  assertEquals(budgetResumeAt(now, ist(2026, 9, 27, 10, 0), 600), now + 60_000);
  // oldest at 11:00 yesterday → 11:05 today would be before now → now + 1 min
  assertEquals(budgetResumeAt(now, ist(2026, 9, 28, 11, 0), 600), now + 60_000);
  // oldest at 16:00 yesterday → 16:05 today
  assertEquals(budgetResumeAt(now, ist(2026, 9, 28, 16, 0), 600), ist(2026, 9, 29, 16, 5));
});

// ---------------------------------------------------------------------------
// Follow-ups (campaign journeys)
// ---------------------------------------------------------------------------
const H = 3600_000;

Deno.test("followupGate: cancel, not started, expired, open", () => {
  const now = ist(2026, 10, 2, 12);
  assertEquals(followupGate({ status: "cancelled", started_at: new Date(now - H).toISOString() }, now), "cancel");
  assertEquals(followupGate({ status: "draft", started_at: null }, now), "wait_parent_start");
  assertEquals(followupGate({ status: "scheduled", started_at: null }, now), "wait_parent_start");
  assertEquals(followupGate({ status: "completed", started_at: new Date(now - FOLLOWUP_LIFETIME_MS).toISOString() }, now), "expired");
  assertEquals(followupGate({ status: "sending", started_at: new Date(now - H).toISOString() }, now), "open");
  assertEquals(followupGate({ status: "paused", started_at: new Date(now - H).toISOString() }, now), "open");
  assertEquals(followupGate(null, now), "open");
});

Deno.test("followupFinish: parent still sending never completes; re-checks within the hour", () => {
  const now = ist(2026, 10, 2, 12);
  const parent = { status: "sending", started_at: new Date(now - 2 * H).toISOString() };
  // nobody pending on time, but the parent may still reach new people
  const r = followupFinish(parent, { next_due_at: null, last_due_at: new Date(now - H).toISOString() }, now);
  assertEquals(r.kind, "defer");
  if (r.kind === "defer") {
    assertEquals(r.resumeAtMs, now + H);
    assertEquals(r.reason, "parent_running");
  }
  // someone becomes eligible in 20 minutes: wake then, not in an hour
  const r2 = followupFinish(parent, { next_due_at: new Date(now + 20 * 60_000).toISOString(), last_due_at: new Date(now + 5 * H).toISOString() }, now);
  assertEquals(r2.kind === "defer" && r2.resumeAtMs, now + 20 * 60_000);
});

Deno.test("followupFinish: paused parent is not terminal", () => {
  const now = ist(2026, 10, 2, 12);
  const r = followupFinish({ status: "paused", started_at: new Date(now - 3 * H).toISOString() }, { last_due_at: null }, now);
  assertEquals(r.kind, "defer");
});

Deno.test("followupFinish: parent done but people still waiting for their time -> wait for the next one", () => {
  const now = ist(2026, 10, 2, 12);
  const parent = { status: "completed", started_at: new Date(now - 30 * H).toISOString() };
  const next = now + 18 * H; // 06:00 IST next day -> quiet hours -> moved to 10:00
  const r = followupFinish(parent, { next_due_at: new Date(next).toISOString(), last_due_at: new Date(now + 20 * H).toISOString() }, now);
  assertEquals(r.kind, "defer");
  if (r.kind === "defer") {
    assertEquals(r.reason, "waiting_for_time");
    assertEquals(r.resumeAtMs, ist(2026, 10, 3, 10));
    assert(!inQuietHours(r.resumeAtMs));
  }
});

Deno.test("followupFinish: complete only when parent terminal AND nobody still to cross the delay", () => {
  const now = ist(2026, 10, 2, 12);
  for (const status of ["completed", "failed"]) {
    const parent = { status, started_at: new Date(now - 72 * H).toISOString() };
    assertEquals(followupFinish(parent, { next_due_at: null, last_due_at: new Date(now - H).toISOString() }, now).kind, "complete");
    assertEquals(followupFinish(parent, { next_due_at: null, last_due_at: null }, now).kind, "complete");
    // last_due_at in the future but next missing (inconsistent read): never complete, look again
    const r = followupFinish(parent, { next_due_at: null, last_due_at: new Date(now + H).toISOString() }, now);
    assertEquals(r.kind, "defer");
  }
});

Deno.test("followupFinish: cancelled parent cancels; 30-day lifetime expires; defer never past the lifetime", () => {
  const now = ist(2026, 10, 2, 12);
  assertEquals(followupFinish({ status: "cancelled", started_at: new Date(now - H).toISOString() }, null, now).kind, "cancel");
  assertEquals(
    followupFinish({ status: "sending", started_at: new Date(now - FOLLOWUP_LIFETIME_MS - 1).toISOString() }, null, now).kind,
    "expired",
  );
  const started = now - FOLLOWUP_LIFETIME_MS + 10 * 60_000; // expires in 10 min
  const r = followupFinish(
    { status: "completed", started_at: new Date(started).toISOString() },
    { next_due_at: new Date(now + 5 * H).toISOString(), last_due_at: new Date(now + 5 * H).toISOString() },
    now,
  );
  assertEquals(r.kind === "defer" && r.resumeAtMs, started + FOLLOWUP_LIFETIME_MS);
});

Deno.test("followupFinish: minimum defer and quiet-hours clamp", () => {
  const now = ist(2026, 10, 2, 20, 59);
  const r = followupFinish(
    { status: "completed", started_at: new Date(now - 5 * H).toISOString() },
    { next_due_at: new Date(now + 1000).toISOString(), last_due_at: new Date(now + 1000).toISOString() },
    now,
  );
  // now+1s -> at least now+60s = 21:00 -> quiet -> next day 10:00
  assertEquals(r.kind === "defer" && r.resumeAtMs, ist(2026, 10, 3, 10));
});

Deno.test("followupFilterError: filter must match the parent + timing exactly", () => {
  const pid = "123e4567-e89b-12d3-a456-426614174000";
  const good = {
    followup_of: pid, followup_after_hours: 48, followup_stage: "read",
    audience_filter: { retarget: { campaign_id: pid, stage: "read", min_hours_since: 48 } },
  };
  assertEquals(followupFilterError(good), null);
  assertEquals(followupFilterError({ audience_filter: { tags: ["x"] } }), null); // not a follow-up
  assert(followupFilterError({ ...good, audience_filter: {} }) !== null);
  assert(followupFilterError({ ...good, audience_filter: { retarget: { ...good.audience_filter.retarget, stage: "delivered" } } }) !== null);
  assert(followupFilterError({ ...good, audience_filter: { retarget: { ...good.audience_filter.retarget, min_hours_since: 2 } } }) !== null);
  assert(followupFilterError({ ...good, audience_filter: { ...good.audience_filter, tags: ["vip"] } }) !== null);
  assert(followupFilterError({ ...good, followup_stage: "not_delivered", audience_filter: { retarget: { campaign_id: pid, stage: "not_delivered", min_hours_since: 48 } } }) !== null);
});

Deno.test("follow-up lifetime: 30 days PLUS the delay, so a long delay can still fire", () => {
  const started = ist(2026, 10, 1, 10);
  const parent = { status: "completed", started_at: new Date(started).toISOString() };
  // 30-day delay: someone reached at the very start is due at day 30 exactly;
  // without the delay in the lifetime they would be expired at that moment.
  const due = started + 720 * H;
  assertEquals(followupGate(parent, due, 720), "open");
  assertEquals(followupGate(parent, due, 0), "expired");
  assertEquals(followupGate(parent, started + FOLLOWUP_LIFETIME_MS + 720 * H, 720), "expired");
  // defer is clamped to the extended end, not the bare 30 days
  const now = started + 29 * 24 * H;
  const r = followupFinish(parent, { next_due_at: new Date(now + 5 * 24 * H).toISOString(), last_due_at: new Date(now + 5 * 24 * H).toISOString() }, now, 600, 14 * 24);
  assertEquals(r.kind === "defer" && r.resumeAtMs, ist(2026, 11, 4, 10));
});

Deno.test("contentChanged: detects an edit between the pre-lock read and the lock", () => {
  const cols = ["template_id", "template_vars", "audience_filter", "header_media_url", "followup_stage", "followup_after_hours"];
  const row = {
    template_id: "t", template_vars: { "1": "x" }, header_media_url: null,
    audience_filter: { retarget: { campaign_id: "p", stage: "read", min_hours_since: 48 } },
    followup_stage: "read", followup_after_hours: 48,
  };
  assertEquals(contentChanged(row, structuredClone(row), cols), false);
  assertEquals(contentChanged(row, { ...row, followup_stage: "not_read" }, cols), true);
  assertEquals(contentChanged(row, { ...row, audience_filter: { retarget: { campaign_id: "p", stage: "read", min_hours_since: 24 } } }, cols), true);
  assertEquals(contentChanged(row, { ...row, header_media_url: undefined }, cols), false); // null == missing
});
