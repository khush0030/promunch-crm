import { describe, expect, it } from "vitest";
import {
  planLines,
  dnsRows,
  healthIssues,
  funnel,
  deviceRows,
  browserRows,
  linkRows,
  domainRows,
  listRows,
  breakdownMissing,
  monthlyTrend,
  fillDays,
  dateWindows,
  sumAggregates,
  istDate,
  type BrevoDomainConfig,
} from "./brevo-shape";

const now = new Date("2026-09-17T03:00:00Z");

const domain: BrevoDomainConfig = {
  domain: "promunch.in",
  verified: true,
  authenticated: true,
  dns_records: {
    dkim_record: null,
    dkim1Record: { type: "CNAME", value: "b1.promunch-in.dkim.brevo.com", host_name: "brevo1._domainkey", status: true },
    dmarc_record: { type: "TXT", value: "v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com", host_name: "_dmarc", status: true },
  },
};

describe("health", () => {
  it("labels plans and counts days left", () => {
    const lines = planLines(
      {
        plan: [{ type: "subscription", credits: 8868, creditsType: "sendLimit", endDate: "2026-09-18" }],
        planVerticals: [{ planCategory: "Marketing", name: "Standard" }],
      },
      now,
    );
    expect(lines[0]).toMatchObject({ label: "Marketing Standard", credits: 8868, daysLeft: 1 });
  });

  it("skips null dns records", () => {
    expect(dnsRows(domain).map((r) => r.label)).toEqual(["DKIM 1", "DMARC"]);
  });

  it("flags renewal, weak DMARC, failing records, inactive senders and missing webhooks", () => {
    const failing: BrevoDomainConfig = {
      domain: "x.in",
      verified: false,
      authenticated: false,
      dns_records: { spf_record: { type: "TXT", value: "v=spf1", host_name: "@", status: false } },
    };
    const issues = healthIssues({
      plans: [{ label: "Marketing Standard", credits: 100, creditsType: "sendLimit", endDate: "2026-09-18", daysLeft: 1 }],
      senders: [{ id: 1, name: "a", email: "a@x.in", active: false }],
      domains: [domain, failing],
      webhooks: [],
    });
    const titles = issues.map((i) => i.title);
    expect(titles).toContain("Marketing Standard renews in 1 day");
    expect(titles).toContain("Only 100 email credits left");
    expect(titles).toContain('promunch.in: DMARC policy is "none"');
    expect(titles).toContain("x.in is not authenticated");
    expect(titles).toContain("x.in: SPF record failing");
    expect(titles).toContain("Sender a@x.in is inactive");
    expect(titles).toContain("No webhooks registered");
  });

  it("does not claim missing webhooks when the webhook read failed", () => {
    expect(healthIssues({ plans: [], senders: [], domains: [], webhooks: null })).toEqual([]);
  });
});

describe("campaign detail", () => {
  it("builds the funnel and caps rates at 100", () => {
    const f = funnel({ sent: 2, delivered: 2, uniqueViews: 3, uniqueClicks: 1, unsubscriptions: 0 });
    expect(f.openRate).toBe(100);
    expect(f.clickRate).toBe(50);
    expect(f.clickToOpen).toBeCloseTo(33.33, 1);
    expect(funnel(undefined).deliveryRate).toBeNull();
  });

  it("groups devices case-insensitively and hides empty systems", () => {
    const d = deviceRows({
      desktop: { windows: { uniqueViews: 35, uniqueClicks: 1 }, otherSystem: { uniqueViews: 66 }, mac: {} },
      mobile: { androidmobile: { uniqueClicks: 1 } },
    });
    expect(d.groups).toEqual([
      { label: "Desktop", opens: 101, clicks: 1 },
      { label: "Mobile", opens: 0, clicks: 1 },
    ]);
    expect(d.systems.map((s) => s.label)).toEqual(["Other desktop", "Windows", "Android phone"]);
  });

  it("sorts browsers and drops zero rows", () => {
    expect(browserRows({ chrome: { uniqueClicks: 2 }, edge: {}, firefox: { uniqueViews: 35 } }).map((b) => b.label)).toEqual(["Firefox", "Chrome"]);
  });

  it("labels links readably and sorts by clicks", () => {
    const rows = linkRows({
      "https://www.instagram.com/promunch.snacks": 0,
      "https://promunch.in/": 5,
      "https://promunch.in/products/%F0%9F%8E%81-hamper": 1,
    });
    expect(rows.map((r) => r.label)).toEqual(["promunch.in", "promunch.in/products/🎁-hamper", "instagram.com/promunch.snacks"]);
  });

  it("sorts domains and lists by delivered and names lists", () => {
    expect(domainRows({ "yahoo.com": { delivered: 16 }, "gmail.com": { delivered: 490 } })[0].domain).toBe("gmail.com");
    const lists = listRows([{ listId: 2, delivered: 2 }, { listId: 4, delivered: 547 }, { listId: 9, delivered: 0 }], new Map([[4, "Rakhi"]]));
    expect(lists.map((l) => l.name)).toEqual(["Rakhi", "List #2", "List #9"]);
  });

  it("detects zeroed breakdowns on a campaign that has activity", () => {
    const f = funnel({ delivered: 10, uniqueViews: 4, uniqueClicks: 1 });
    expect(breakdownMissing(f, [{ opens: 0, clicks: 0 }])).toBe(true);
    expect(breakdownMissing(f, [{ opens: 1, clicks: 0 }])).toBe(false);
    expect(breakdownMissing(funnel({}), [{ clicks: 0 }])).toBe(false);
  });
});

describe("reports", () => {
  it("buckets campaigns by IST month, zero-filled, oldest first", () => {
    const trend = monthlyTrend(
      [
        { date: "2026-08-20T16:22:59.000+05:30", delivered: 548, opens: 105, clicks: 3, unsubscribes: 4, bounces: 13 },
        // 31 Aug 20:00 UTC is 1 Sep in IST.
        { date: "2026-08-31T20:00:00Z", delivered: 100, opens: 10, clicks: 1, unsubscribes: 0, bounces: 0 },
        { date: "2026-08-21T00:00:00Z", delivered: 0, opens: 0, clicks: 0, unsubscribes: 0, bounces: 0 },
        { date: "2025-01-01T00:00:00Z", delivered: 5, opens: 0, clicks: 0, unsubscribes: 0, bounces: 0 },
      ],
      now,
      3,
    );
    expect(trend.map((b) => b.label)).toEqual(["Jul 26", "Aug 26", "Sep 26"]);
    expect(trend[1]).toMatchObject({ campaigns: 1, delivered: 548 });
    expect(trend[2]).toMatchObject({ campaigns: 1, delivered: 100, openRate: 10 });
    expect(trend[0].openRate).toBeNull();
  });

  it("fills missing days", () => {
    const rows = fillDays([{ date: "2026-09-02", delivered: 4 }], "2026-09-01", "2026-09-03", ["delivered"]);
    expect(rows).toEqual([
      { date: "2026-09-01", delivered: 0 },
      { date: "2026-09-02", delivered: 4 },
      { date: "2026-09-03", delivered: 0 },
    ]);
  });

  it("splits ranges into 30-day windows", () => {
    const w = dateWindows("2026-06-20", "2026-09-17");
    expect(w).toEqual([
      { start: "2026-06-20", end: "2026-07-19" },
      { start: "2026-07-20", end: "2026-08-18" },
      { start: "2026-08-19", end: "2026-09-17" },
    ]);
    expect(dateWindows("2026-09-11", "2026-09-17")).toEqual([{ start: "2026-09-11", end: "2026-09-17" }]);
  });

  it("sums numeric aggregate fields only", () => {
    expect(sumAggregates([{ range: "a", delivered: 2 }, { range: "b", delivered: 3, opens: 1 }])).toEqual({ delivered: 5, opens: 1 });
  });

  it("formats IST dates across the UTC midnight boundary", () => {
    expect(istDate(new Date("2026-09-16T20:00:00Z"))).toBe("2026-09-17");
  });
});
