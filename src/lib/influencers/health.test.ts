import { describe, expect, it } from "vitest";
import {
  boardSummary,
  computeHealth,
  draftDueAt,
  stagePatch,
  istDay,
  reliability,
  stageGroup,
  stagesInGroup,
  OPEN_STAGES,
  type HealthDeal,
  type SummaryDeal,
} from "./health";
import { DEAL_CODE_RE, generateDealCode, normalizeHandle, normalizePhone, pickKit, cleanNiche } from "./normalize";

const NOW = Date.parse("2026-10-07T06:30:00Z"); // 12:00 IST
const H = 3_600_000;
const D = 24 * H;
const at = (ms: number) => new Date(ms).toISOString();

function deal(over: Partial<HealthDeal>): HealthDeal {
  return {
    stage: "agreed",
    agreed_at: at(NOW - 1 * H),
    brief_sent_at: null,
    brief_acknowledged_at: null,
    dispatched_at: null,
    delivered_at: null,
    draft_due_at: null,
    draft_submitted_at: null,
    go_live_at: null,
    ...over,
  };
}

describe("computeHealth", () => {
  it("closed stages are closed", () => {
    for (const stage of ["completed", "cancelled", "ghosted"] as const) {
      expect(computeHealth(deal({ stage }), NOW).health).toBe("closed");
    }
  });

  it("fresh agreed deal is on track with a ship-by date", () => {
    const r = computeHealth(deal({}), NOW);
    expect(r.health).toBe("on_track");
    expect(r.next_date).toEqual({ label: "Ship kit by", at: at(NOW - H + 48 * H) });
  });

  it("agreed > 48h without dispatch is waiting on us", () => {
    expect(computeHealth(deal({ agreed_at: at(NOW - 49 * H) }), NOW).health).toBe("waiting_on_us");
  });

  it("brief draft > 24h is waiting on us", () => {
    expect(computeHealth(deal({ stage: "brief_draft", agreed_at: at(NOW - 23 * H) }), NOW).health).toBe("on_track");
    const r = computeHealth(deal({ stage: "brief_draft", agreed_at: at(NOW - 25 * H) }), NOW);
    expect(r.health).toBe("waiting_on_us");
    expect(r.reason).toBe("Brief waiting for approval");
  });

  it("brief unacknowledged > 72h is at risk", () => {
    expect(computeHealth(deal({ stage: "brief_sent", brief_sent_at: at(NOW - 71 * H) }), NOW).health).toBe("on_track");
    const r = computeHealth(deal({ stage: "brief_sent", brief_sent_at: at(NOW - 4 * D) }), NOW);
    expect(r.health).toBe("at_risk");
    expect(r.reason).toBe("Brief not acknowledged for 4 days");
  });

  it("acknowledged > 48h without dispatch is waiting on us", () => {
    const r = computeHealth(deal({ stage: "brief_acknowledged", brief_acknowledged_at: at(NOW - 50 * H) }), NOW);
    expect(r.health).toBe("waiting_on_us");
  });

  it("delivery unconfirmed > 8d after dispatch is at risk", () => {
    expect(computeHealth(deal({ stage: "dispatched", dispatched_at: at(NOW - 7 * D) }), NOW).health).toBe("on_track");
    expect(computeHealth(deal({ stage: "dispatched", dispatched_at: at(NOW - 9 * D) }), NOW).health).toBe("at_risk");
  });

  it("draft due: on track, at risk within 2 days, overdue after", () => {
    expect(computeHealth(deal({ stage: "delivered", draft_due_at: at(NOW + 5 * D) }), NOW).health).toBe("on_track");
    const risk = computeHealth(deal({ stage: "delivered", draft_due_at: at(NOW + 1 * D + H) }), NOW);
    expect(risk.health).toBe("at_risk");
    expect(risk.reason).toBe("Draft due in 1 day");
    const today = computeHealth(deal({ stage: "changes_requested", draft_due_at: at(NOW + 3 * H) }), NOW);
    expect(today.reason).toBe("Draft due today");
    const late = computeHealth(deal({ stage: "delivered", draft_due_at: at(NOW - 3 * D - H) }), NOW);
    expect(late.health).toBe("overdue");
    expect(late.reason).toBe("Draft overdue by 3 days");
    expect(late.next_date?.label).toBe("Draft due");
  });

  it("draft submitted > 24h unreviewed is waiting on us", () => {
    expect(computeHealth(deal({ stage: "draft_submitted", draft_submitted_at: at(NOW - 2 * H) }), NOW).health).toBe("on_track");
    expect(computeHealth(deal({ stage: "draft_submitted", draft_submitted_at: at(NOW - 25 * H) }), NOW).health).toBe(
      "waiting_on_us",
    );
  });

  it("approved, not posted, past go-live + 2d is overdue", () => {
    expect(computeHealth(deal({ stage: "draft_approved", go_live_at: at(NOW - 1 * D) }), NOW).health).toBe("on_track");
    expect(computeHealth(deal({ stage: "draft_approved", go_live_at: at(NOW - 3 * D) }), NOW).health).toBe("overdue");
  });

  it("settings override thresholds", () => {
    const settings = { team_sla: { brief_approval_hours: 4 }, nudges: { brief_ack: { escalate_after_hours: 10 } } };
    expect(computeHealth(deal({ stage: "brief_draft", agreed_at: at(NOW - 5 * H) }), NOW, settings).health).toBe(
      "waiting_on_us",
    );
    expect(computeHealth(deal({ stage: "brief_sent", brief_sent_at: at(NOW - 11 * H) }), NOW, settings).health).toBe(
      "at_risk",
    );
  });
});

describe("reliability", () => {
  it("empty", () => {
    expect(reliability([], NOW)).toEqual({
      deals_total: 0,
      deals_completed: 0,
      on_time_pct: null,
      avg_days_late: null,
      ghosted: 0,
      avg_revisions: null,
    });
  });

  it("counts on-time, late, missing-overdue, ghosted and revisions", () => {
    const r = reliability(
      [
        { stage: "completed", draft_due_at: at(NOW - 10 * D), draft_submitted_at: at(NOW - 11 * D), revision_count: 1 },
        { stage: "posted", draft_due_at: at(NOW - 10 * D), draft_submitted_at: at(NOW - 8 * D), revision_count: 0 },
        { stage: "ghosted", draft_due_at: at(NOW - 4 * D), draft_submitted_at: null, revision_count: 0 },
        { stage: "delivered", draft_due_at: at(NOW + 4 * D), draft_submitted_at: null, revision_count: 0 },
      ],
      NOW,
    );
    expect(r.deals_total).toBe(4);
    expect(r.deals_completed).toBe(2);
    expect(r.on_time_pct).toBe(33); // 1 of 3 judged
    expect(r.avg_days_late).toBe(3); // (2 + 4) / 2
    expect(r.ghosted).toBe(1);
    expect(r.avg_revisions).toBe(0.5);
  });
});

describe("stage groups", () => {
  it("every open stage maps to a non-done group", () => {
    for (const s of OPEN_STAGES) expect(stageGroup(s)).not.toBe("done");
    expect(stagesInGroup("review")).toEqual(["draft_submitted"]);
    expect(stagesInGroup("done")).toEqual(["completed", "cancelled", "ghosted"]);
  });
});

describe("boardSummary", () => {
  it("counts health buckets, due today, kits and queues for open deals only", () => {
    const base = { shopify_order_id: null } as const;
    const deals: SummaryDeal[] = [
      { ...deal({ stage: "delivered", draft_due_at: at(NOW - 2 * D) }), id: "a", ...base },
      { ...deal({ stage: "delivered", draft_due_at: at(NOW + 2 * H) }), id: "b", ...base },
      { ...deal({ stage: "brief_draft", agreed_at: at(NOW - 30 * H) }), id: "c", ...base },
      { ...deal({ stage: "brief_acknowledged", brief_acknowledged_at: at(NOW - H) }), id: "d", ...base },
      { ...deal({ stage: "completed" }), id: "e", ...base },
    ];
    const s = boardSummary(deals, { briefDealIds: ["c", "e"], pendingDraftDealIds: ["x"] }, NOW);
    expect(s).toEqual({
      due_today: 1,
      overdue: 1,
      at_risk: 1,
      waiting_on_us: 1,
      briefs_to_approve: 1,
      drafts_to_review: 0,
      kits_to_ship: 2,
    });
  });

  it("istDay uses IST", () => {
    expect(istDay(Date.parse("2026-10-07T19:00:00Z"))).toBe("2026-10-08");
  });
});

describe("normalize", () => {
  it("handles", () => {
    expect(normalizeHandle("@Foo.Bar_")).toBe("foo.bar_");
    expect(normalizeHandle("https://www.instagram.com/Some.One/?hl=en")).toBe("some.one");
    expect(normalizeHandle("bad handle")).toBeNull();
    expect(normalizeHandle("")).toBeNull();
  });
  it("phones", () => {
    expect(normalizePhone("98765 43210")).toBe("919876543210");
    expect(normalizePhone("+91-98765-43210")).toBe("919876543210");
    expect(normalizePhone("09876543210")).toBe("919876543210");
    expect(normalizePhone("0044 7700 900123")).toBe("447700900123");
    expect(normalizePhone("12345")).toBeNull();
  });
  it("deal codes are 12 url-safe chars and distinct", () => {
    const a = generateDealCode();
    const b = generateDealCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(DEAL_CODE_RE.test(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it("niche cleaning", () => {
    expect(cleanNiche("Fitness, food ,fitness")).toEqual(["fitness", "food"]);
  });
  it("pickKit by priority, followers range and niche", () => {
    const kits = [
      { id: "k1", active: true },
      { id: "k2", active: true },
      { id: "k3", active: false },
    ];
    const rules = [
      { priority: 1, min_followers: null, max_followers: null, niche: "fitness", kit_id: "k3" },
      { priority: 10, min_followers: 50000, max_followers: null, niche: null, kit_id: "k2" },
      { priority: 20, min_followers: null, max_followers: null, niche: null, kit_id: "k1" },
    ];
    expect(pickKit(rules, kits, 60000, ["fitness"])).toBe("k2");
    expect(pickKit(rules, kits, 5000, ["fitness"])).toBe("k1");
    expect(pickKit(rules, kits, null, [])).toBe("k1");
    expect(pickKit([], kits, 1, [])).toBeNull();
  });
});

describe("stagePatch", () => {
  const base = {
    brief_sent_at: null,
    brief_acknowledged_at: null,
    dispatched_at: null,
    delivered_at: null,
    draft_submitted_at: null,
    draft_approved_at: null,
    go_live_at: null,
    posted_at: null,
    completed_at: null,
    draft_due_days: 10,
  };
  const opts = { postAfterApprovalDays: 3 };

  it("delivered sets delivered_at and draft_due_at = delivered + days", () => {
    expect(stagePatch(base, "delivered", NOW, opts)).toEqual({
      delivered_at: at(NOW),
      draft_due_at: at(NOW + 10 * D),
    });
    const given = at(NOW - 2 * D);
    expect(stagePatch({ ...base, draft_due_days: 7 }, "delivered", NOW, { ...opts, deliveredAt: given })).toEqual({
      delivered_at: given,
      draft_due_at: at(NOW + 5 * D),
    });
  });

  it("approval defaults go_live_at but keeps a planned one", () => {
    expect(stagePatch(base, "draft_approved", NOW, opts)).toEqual({
      draft_approved_at: at(NOW),
      go_live_at: at(NOW + 3 * D),
    });
    const planned = at(NOW + 9 * D);
    expect(stagePatch({ ...base, go_live_at: planned }, "draft_approved", NOW, opts).go_live_at).toBe(planned);
  });

  it("keeps first-time timestamps", () => {
    const first = at(NOW - 5 * D);
    expect(stagePatch({ ...base, draft_submitted_at: first }, "draft_submitted", NOW, opts)).toEqual({
      draft_submitted_at: first,
    });
    expect(stagePatch(base, "cancelled", NOW, opts)).toEqual({});
  });

  it("draftDueAt", () => {
    expect(draftDueAt("2026-10-01T00:00:00.000Z", 15)).toBe("2026-10-16T00:00:00.000Z");
  });
});
