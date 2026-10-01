// Pure helpers for the Automations tab (no React), unit-tested in logic.test.ts.

import { friendlyTemplateName, renderBlanks, templateKind } from "@/lib/whatsapp/templateKind";
import type { CustomFlow, CustomStep, TriggerEvent } from "./types";

/* ---------------- durations ---------------- */

export type DurationUnit = "minutes" | "hours" | "days";

/** Best unit to show an hour value in: whole days as days, whole hours as hours. */
export function bestUnit(hours: number, units: DurationUnit[] = ["hours", "days"]): DurationUnit {
  if (units.includes("days") && hours >= 24 && hours % 24 === 0) return "days";
  if (units.includes("minutes") && hours < 1) return "minutes";
  if (units.includes("hours")) return "hours";
  return units[0];
}

export function toUnit(hours: number, unit: DurationUnit): number {
  const v = unit === "days" ? hours / 24 : unit === "minutes" ? hours * 60 : hours;
  return Math.round(v * 100) / 100;
}

export function fromUnit(value: number, unit: DurationUnit): number {
  const h = unit === "days" ? value * 24 : unit === "minutes" ? value / 60 : value;
  return Math.round(h * 10000) / 10000;
}

/** "right away", "30 minutes", "1 hour", "6 hours", "2 days", "1.5 days". */
export function friendlyDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "right away";
  if (hours < 1) {
    const m = Math.round(hours * 60);
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  if (hours >= 24 && hours % 24 === 0) {
    const d = hours / 24;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (hours >= 48) {
    const d = Math.round((hours / 24) * 10) / 10;
    return `${d} days`;
  }
  const h = Math.round(hours * 100) / 100;
  return `${h} hour${h === 1 ? "" : "s"}`;
}

/* ---------------- custom flow steps: gaps <-> offsets ----------------
   The engine stores each step's delay measured from the TRIGGER, strictly
   increasing. The builder shows "wait X after the previous step", which is
   easier to reason about. */

export function offsetsToGaps(offsets: number[]): number[] {
  return offsets.map((o, i) => (i === 0 ? o : o - offsets[i - 1]));
}

export function gapsToOffsets(gaps: number[]): number[] {
  const out: number[] = [];
  gaps.forEach((g, i) => out.push(Math.round(((i === 0 ? 0 : out[i - 1]) + g) * 10000) / 10000));
  return out;
}

/** Plain-words problem with a list of waits, or null when they are fine. */
export function gapsError(gaps: number[]): string | null {
  for (const [i, g] of gaps.entries()) {
    if (!Number.isFinite(g) || g < 0) return `Message ${i + 1}: the wait can't be negative.`;
    if (i > 0 && g <= 0) return `Message ${i + 1}: wait at least a little after the message before it.`;
  }
  const total = gapsToOffsets(gaps).at(-1) ?? 0;
  if (total > 24 * 90) return "The last message must go within 90 days of the start.";
  return null;
}

/* ---------------- triggers ---------------- */

export const TRIGGER_TEXT: Record<TriggerEvent, { short: string; when: string }> = {
  order_placed: { short: "Order placed", when: "When a customer places an order" },
  order_fulfilled: { short: "Order shipped", when: "When an order is shipped from the warehouse" },
  checkout_abandoned: { short: "Cart left behind", when: "When someone leaves items in their cart without ordering" },
};

export function stopRuleFor(t: TriggerEvent): string {
  return t === "checkout_abandoned"
    ? "They place the order, or they reply STOP"
    : "The order is cancelled, or they reply STOP";
}

/* ---------------- blanks (template variables) ----------------
   Custom flows fill a template's numbered blanks with text that may contain
   these tokens (resolveVars in _shared/custom-flows.ts). Nothing else is
   substituted by the engine. */

export type BlankToken = { token: string; label: string; sample: string; triggers?: TriggerEvent[] };

export const BLANK_TOKENS: BlankToken[] = [
  { token: "{name}", label: "Customer first name", sample: "Priya" },
  { token: "{order_ref}", label: "Order number", sample: "#1234", triggers: ["order_placed", "order_fulfilled"] },
  { token: "{checkout_url}", label: "Their cart link", sample: "https://promunch.in/checkouts/abc123", triggers: ["checkout_abandoned"] },
];

export function tokensFor(trigger: TriggerEvent): BlankToken[] {
  return BLANK_TOKENS.filter((t) => !t.triggers || t.triggers.includes(trigger));
}

/** Replace the engine tokens with sample values (for previews and tests). */
export function fillSample(value: string, overrides: Partial<Record<string, string>> = {}): string {
  let out = value;
  for (const t of BLANK_TOKENS) out = out.split(t.token).join(overrides[t.token] ?? t.sample);
  return out;
}

/** Numbered blanks ("1", "2", ...) used in a template body, in order, unique. */
export function blankKeys(body: string | null | undefined): string[] {
  const keys: string[] = [];
  for (const seg of renderBlanks(body ?? "")) {
    if (seg.kind === "chip" && /^\d+$/.test(seg.key) && !keys.includes(seg.key)) keys.push(seg.key);
  }
  return keys;
}

/** Template body with each {{n}} replaced by vars[n] (or a readable placeholder). */
export function fillBody(body: string, vars: Record<string, string>, placeholder = (k: string) => `[Blank ${k}]`): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, k: string) => {
    const v = (vars[k] ?? "").trim();
    return v ? v : placeholder(k);
  });
}

/* ---------------- sample values for built-in automations ----------------
   What each built-in template's blanks carry (shopify-wa, order-confirmation,
   cod-gate, journeys). Used only to render a realistic preview. */

const SAMPLE_BY_TEMPLATE: Array<[RegExp, Record<string, string>]> = [
  [/^order_confirmation/, { "1": "Priya", "2": "#1234", "3": "₹599" }],
  [/^shipping_update/, { "1": "Priya", "2": "#1234", "3": "https://promunch.in/orders/status" }],
  [/^abandoned_cart/, { "1": "Priya", "2": "https://promunch.in/checkouts/abc123" }],
  [/^review_request/, { "1": "Priya", "2": "https://promunch.in/pages/review-submission" }],
  [/^replenishment_reminder/, { "1": "Priya", "2": "https://promunch.in" }],
  [/^cod/, { "1": "Priya", "2": "#1234", "3": "₹649" }],
];

export function sampleVarsFor(templateName: string): Record<string, string> {
  const hit = SAMPLE_BY_TEMPLATE.find(([re]) => re.test(templateName));
  return hit ? hit[1] : { "1": "Priya" };
}

/* ---------------- templates ---------------- */

export type TemplateLite = {
  id?: string;
  name: string;
  language: string;
  status: string;
  category?: string | null;
  body?: string | null;
};

/** Approved marketing templates a custom flow may send, newest name order kept. */
export function flowTemplateOptions<T extends TemplateLite>(templates: T[]): T[] {
  return templates.filter((t) => t.status === "approved" && templateKind(t) === "marketing");
}

export function templateStatusText(name: string, templates: TemplateLite[]): { tone: "good" | "warn" | "crit"; text: string } {
  const t = templates.find((x) => x.name === name);
  if (!t) return { tone: "crit", text: "Message not found. Sends wait until it exists in Templates." };
  if (t.status === "approved") return { tone: "good", text: "Approved by Meta" };
  return { tone: "warn", text: `Waiting for Meta (${t.status}). Sends wait until it is approved.` };
}

export { friendlyTemplateName };

/* ---------------- recipes ---------------- */

export type RecipeKey = "welcome" | "abandoned_cart" | "review" | "restock" | "winback" | "cross_sell";

export type Recipe = {
  key: RecipeKey;
  title: string;
  when: string;
  wait?: string;
  sends: string;
  /** "builtin": already runs as a built-in automation; "soon": the engine has no trigger for it yet. */
  availability: { kind: "custom"; trigger: TriggerEvent; waitHours: number; name: string } | { kind: "builtin"; card: string } | { kind: "soon"; why: string };
};

export const RECIPES: Recipe[] = [
  {
    key: "welcome",
    title: "Welcome new subscriber",
    when: "Someone joins your WhatsApp list from the website popup",
    sends: "A friendly hello with a first-order offer",
    availability: {
      kind: "soon",
      why: "Coming soon: automations can't start from a popup sign-up yet.",
    },
  },
  {
    key: "abandoned_cart",
    title: "Abandoned cart",
    when: "Someone leaves items in their cart",
    wait: "1 hour, then a coupon later",
    sends: "A reminder with their cart link",
    availability: { kind: "builtin", card: "abandoned_cart" },
  },
  {
    key: "review",
    title: "Review ask after delivery",
    when: "A week after someone orders (time for delivery)",
    wait: "7 days",
    sends: "A request to review what they bought",
    availability: { kind: "builtin", card: "review" },
  },
  {
    key: "restock",
    title: "Restock reminder",
    when: "About when their snacks run out",
    wait: "30 days",
    sends: "A nudge to order again",
    availability: { kind: "builtin", card: "restock" },
  },
  {
    key: "winback",
    title: "Win back inactive customers",
    when: "A customer hasn't ordered for a while",
    sends: "A come-back offer",
    availability: {
      kind: "soon",
      why: "Coming soon: automations can't start from \"no order for a while\" yet. Until then, send a campaign to the \"At risk\" or \"Dormant\" customer group.",
    },
  },
  {
    key: "cross_sell",
    title: "Post-delivery cross-sell",
    when: "An order is shipped",
    wait: "5 days",
    sends: "A suggestion to try another flavour",
    availability: { kind: "custom", trigger: "order_fulfilled", waitHours: 5 * 24, name: "Try another flavour after delivery" },
  },
];

/* ---------------- custom flow payloads ---------------- */

export type DraftMessage = { gapHours: number; template: string; language: string; vars: Record<string, string> };

export function draftFromFlow(f: CustomFlow): DraftMessage[] {
  const gaps = offsetsToGaps(f.steps.map((s) => Number(s.delay_hours)));
  return f.steps.map((s, i) => ({ gapHours: gaps[i], template: s.template, language: s.language ?? "en", vars: { ...(s.vars ?? {}) } }));
}

/** Blanks still empty, as plain words ("Message 1: blank 2"). */
export function missingBlanks(messages: DraftMessage[], bodyOf: (name: string) => string): string[] {
  return messages.flatMap((m, i) =>
    blankKeys(bodyOf(m.template))
      .filter((k) => !(m.vars[k] ?? "").trim())
      .map((k) => `Message ${i + 1}, blank ${k}`),
  );
}

export function stepsPayload(messages: DraftMessage[], bodyOf: (name: string) => string, langOf: (name: string) => string | undefined): CustomStep[] {
  const offsets = gapsToOffsets(messages.map((m) => m.gapHours));
  return messages.map((m, i) => ({
    delay_hours: offsets[i],
    template: m.template,
    language: langOf(m.template) ?? m.language ?? "en",
    vars: Object.fromEntries(blankKeys(bodyOf(m.template)).map((k) => [k, (m.vars[k] ?? "").trim()])),
  }));
}

/** Digits-only WhatsApp number; a bare 10-digit Indian mobile gets 91. Null if not plausible. */
export function normalizeTestNumber(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
