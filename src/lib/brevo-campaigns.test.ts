import { describe, expect, it } from "vitest";
import { summarize, toRow, sortRows, type BrevoCampaign } from "./brevo-campaigns";

const now = new Date("2026-09-17T00:00:00Z");

const sent: BrevoCampaign = {
  id: 6,
  name: "Rakhi Hamper",
  subject: "Make Raksha Bandhan Special",
  status: "sent",
  sentDate: "2026-08-20T16:22:59.000+05:30",
  statistics: {
    globalStats: { sent: 561, delivered: 548, uniqueViews: 105, uniqueClicks: 3, unsubscriptions: 4, hardBounces: 0, softBounces: 13, appleMppOpens: 70 },
  },
};
const cancelledMidSend: BrevoCampaign = {
  id: 1,
  name: "Rakhi Hamper",
  status: "cancelled",
  createdAt: "2026-08-19T10:00:00.000+05:30",
  statistics: { globalStats: { sent: 582, delivered: 539, uniqueViews: 148, uniqueClicks: 4, unsubscriptions: 10, hardBounces: 15, softBounces: 13, appleMppOpens: 94 } },
};
const draft: BrevoCampaign = {
  id: 12,
  name: "Rakhi Hamper",
  status: "draft",
  createdAt: "2026-08-26T17:17:32.000+05:30",
  statistics: { globalStats: { sent: 0, delivered: 0 } },
};
const old: BrevoCampaign = {
  id: 0,
  name: "Old",
  status: "sent",
  sentDate: "2026-01-01T00:00:00Z",
  statistics: { globalStats: { delivered: 100, uniqueViews: 50 } },
};

describe("toRow", () => {
  it("computes rates against delivered and sums bounces", () => {
    const r = toRow(sent);
    expect(r.bounces).toBe(13);
    expect(r.openRate).toBeCloseTo(19.16, 1);
    expect(r.clickRate).toBeCloseTo(0.55, 1);
  });

  it("gives null rates when nothing was delivered", () => {
    const r = toRow(draft);
    expect(r.openRate).toBeNull();
    expect(r.clickRate).toBeNull();
    expect(r.date).toBe(draft.createdAt);
  });

  it("tolerates missing statistics", () => {
    const r = toRow({ id: 9, name: "x", status: "draft" });
    expect(r.sent).toBe(0);
    expect(r.date).toBeNull();
  });
});

describe("summarize", () => {
  it("counts delivered campaigns in window, including a cancelled one that went out", () => {
    const s = summarize([sent, cancelledMidSend, draft, old], now, 90);
    expect(s.campaignsSent).toBe(2);
    expect(s.delivered).toBe(1087);
    expect(s.unsubscribes).toBe(14);
    expect(s.bounces).toBe(41);
    expect(s.openRate).toBeCloseTo((253 / 1087) * 100, 5);
    expect(s.mppShare).toBeCloseTo((164 / 253) * 100, 5);
  });

  it("returns null rates with no campaigns", () => {
    const s = summarize([draft], now);
    expect(s.campaignsSent).toBe(0);
    expect(s.openRate).toBeNull();
    expect(s.mppShare).toBeNull();
  });
});

describe("sortRows", () => {
  it("orders newest first with undated last", () => {
    const rows = sortRows([toRow(old), toRow({ id: 9, name: "x", status: "draft" }), toRow(draft), toRow(sent)]);
    expect(rows.map((r) => r.id)).toEqual([12, 6, 0, 9]);
  });
});
