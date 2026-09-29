// Pure helpers for the Results (analytics) tab. Unit-tested in logic.test.ts.

export const MIN_SENDS_TO_GRADE = 50;

export type CampaignCardLite = { name: string; sent: number };

/** Internal tests: "LIVE TEST ..." names or a send to one person. Never graded or counted in ROI. */
export function isTestCampaign(c: CampaignCardLite): boolean {
  return /^\s*live\s*test/i.test(c.name) || c.sent <= 1;
}

export function canGrade(c: CampaignCardLite): boolean {
  return !isTestCampaign(c) && c.sent >= MIN_SENDS_TO_GRADE;
}

/** "4 in 100" style rate. Null when there is no base. Clamped to 0..100. */
export function inHundred(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const num = (n: number) => n.toLocaleString("en-IN");

export type Headline = {
  sent: number; delivered: number; read: number; replies: number; orders: number; revenue: number; spend: number;
};

/** Plain sentences for the chosen period. */
export function periodSentences(days: number, h: Headline, notArrived: number, heldBack: number): string[] {
  if (h.sent === 0) return [`No WhatsApp messages went out in the last ${days} days.`];
  const out: string[] = [];
  const del = inHundred(h.delivered, h.sent) ?? 0;
  const rd = inHundred(h.read, h.sent) ?? 0;
  out.push(`In the last ${days} days we sent ${num(h.sent)} WhatsApp messages. ${del} in 100 reached people's phones and ${rd} in 100 were read.`);
  out.push(h.replies > 0 ? `Customers wrote back ${num(h.replies)} times.` : "Nobody wrote back yet.");
  out.push(
    h.orders > 0
      ? `${num(h.orders)} order${h.orders === 1 ? "" : "s"} (${inr(h.revenue)}) came from people who got a message from us first.`
      : "No orders came from people we messaged yet.",
  );
  if (notArrived > 0) {
    out.push(
      heldBack > 0
        ? `${num(notArrived)} message${notArrived === 1 ? "" : "s"} did not arrive. ${num(heldBack)} of them were held back by Meta or went to numbers without WhatsApp, which is normal.`
        : `${num(notArrived)} message${notArrived === 1 ? "" : "s"} did not arrive. See below for why.`,
    );
  }
  return out;
}

export type CampaignSummaryInput = { name: string; sent: number; readPct: number; orders: number; revenue: number };

/** One sentence about the most recent real (non-test) campaign, or null. */
export function lastCampaignSentence<T extends CampaignSummaryInput>(cards: T[]): string | null {
  const c = cards.find((x) => !isTestCampaign(x));
  if (!c) return null;
  if (c.sent < MIN_SENDS_TO_GRADE) {
    return `Your latest campaign, "${c.name}", has gone to ${num(c.sent)} people so far. That is too early to judge.`;
  }
  const orders = c.orders > 0 ? `led to ${num(c.orders)} order${c.orders === 1 ? "" : "s"} (${inr(c.revenue)})` : "has not led to an order yet";
  return `Your latest campaign, "${c.name}", went to ${num(c.sent)} people: ${c.readPct} in 100 read it and it ${orders}.`;
}
