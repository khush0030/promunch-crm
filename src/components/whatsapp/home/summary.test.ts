import { describe, expect, it } from "vitest";
import { avgOrder, campaignFunnel, campaignNextStep, campaignSentence, latestCampaign, returnMultiple, returnTone } from "./summary";

const base = {
  name: "Diwali",
  status: "completed" as const,
  sent_count: 500,
  delivered_count: 480,
  read_count: 300,
  replied_count: 12,
  total_audience: 500,
};

describe("campaignSentence", () => {
  it("reads like a sentence", () => {
    expect(campaignSentence(base, 4)).toBe(
      'Your last campaign "Diwali" went to 500 people. 480 got it, 300 read it (63%), 12 replied and 4 ordered.',
    );
    expect(campaignSentence(base, null)).toBe('Your last campaign "Diwali" went to 500 people. 480 got it, 300 read it (63%) and 12 replied.');
  });
  it("handles live, draft and unsent campaigns", () => {
    expect(campaignSentence({ ...base, status: "sending" }, null)).toMatch(/has gone to 500 people so far/);
    expect(campaignSentence({ ...base, status: "draft", sent_count: 0 }, null)).toMatch(/still a draft/);
    expect(campaignSentence({ ...base, sent_count: 1, delivered_count: 0, read_count: 0 }, null, { lead: "It" })).toMatch(/^It went to 1 person\./);
  });
  it("never uses em dashes", () => {
    expect(campaignSentence(base, 1)).not.toMatch(/—/);
  });
});

describe("campaignNextStep", () => {
  it("suggests following up people who didn't read", () => {
    const s = campaignNextStep(base)!;
    expect(s.stage).toBe("not_read");
    expect(s.title).toMatch(/^180 people got it but didn't read it/);
  });
  it("then people who read but didn't reply", () => {
    expect(campaignNextStep({ ...base, read_count: 470 })!.stage).toBe("read_no_reply");
  });
  it("is calm while sending and silent before anything went out", () => {
    expect(campaignNextStep({ ...base, status: "sending" })!.stage).toBeUndefined();
    expect(campaignNextStep({ ...base, sent_count: 0 })).toBeNull();
    expect(campaignNextStep({ ...base, read_count: 475, replied_count: 470 })!.tone).toBe("success");
  });
});

describe("latestCampaign", () => {
  it("prefers the newest campaign that reached someone", () => {
    const list = [
      { id: "a", created_at: "2026-09-01T00:00:00Z", sent_count: 10 },
      { id: "b", created_at: "2026-09-20T00:00:00Z", sent_count: 0 },
      { id: "c", created_at: "2026-09-10T00:00:00Z", sent_count: 5 },
    ];
    expect(latestCampaign(list)?.id).toBe("c");
    expect(latestCampaign([list[1]])?.id).toBe("b");
    expect(latestCampaign([])).toBeNull();
  });
});

describe("campaign return", () => {
  it("formats multiples", () => {
    expect(returnMultiple(34.2)).toBe("34×");
    expect(returnMultiple(2.84)).toBe("2.8×");
    expect(returnMultiple(null)).toBeNull();
  });
  it("colours multiples", () => {
    expect(returnTone(5)).toBe("good");
    expect(returnTone(1.5)).toBe("warn");
    expect(returnTone(0.4)).toBe("crit");
    expect(returnTone(null)).toBe("neu");
  });
  it("averages orders", () => {
    expect(avgOrder({ orders: 4, revenue: 2000 })).toBe(500);
    expect(avgOrder({ orders: 0, revenue: 0 })).toBeNull();
  });
  it("builds the funnel from what the campaign records", () => {
    const f = campaignFunnel({ delivered_count: 200, read_count: 150, clicked_count: 20 }, 5);
    expect(f.map((s) => s.key)).toEqual(["delivered", "read", "clicked", "bought"]);
    expect(f[1].pct).toBe(75);
    expect(f[3].pct).toBe(2.5);
    expect(campaignFunnel({ delivered_count: 10, read_count: 5, clicked_count: null }, null).map((s) => s.key)).toEqual(["delivered", "read"]);
  });
});
