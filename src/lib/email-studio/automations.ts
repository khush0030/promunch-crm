// Plain-words helpers for the Email Studio Automations page. Pure, so the
// list route and tests share them. Keep imports relative: vitest has no "@/".

import { copyIssues, type Issue } from "./checks";

export type FlowStats = {
  entered: number;
  active: number;
  converted: number;
  sent: number;
  opened: number;
  clicked: number;
};

const TRIGGERS: Record<string, string> = {
  checkout_abandoned: "Checkout started but not paid",
  order_placed: "Order placed",
  customer_created: "New subscriber",
  segment_entry: "Joins an audience",
  date_based: "Date based",
};

export function triggerLabel(t: string): string {
  return TRIGGERS[t] ?? t;
}

/** "15 min", "5 h", "7 days" for a step delay in hours. */
export function delayLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "right away";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  const d = hours / 24;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} days`;
}

/** Audience + stop rules from trigger_config, as short sentences. */
export function describeFlowRules(trigger: string, cfg: Record<string, unknown>): string[] {
  const out: string[] = [triggerLabel(trigger)];
  if (cfg.first_order_only === true) out.push("First order only");
  if (typeof cfg.once_per_contact_days === "number" && cfg.once_per_contact_days > 0) {
    out.push(`At most once every ${cfg.once_per_contact_days} days per person`);
  }
  if (cfg.exit_on_reorder === true) out.push("Stops if they order again");
  if (typeof cfg.deadline_hours === "number") out.push(`Stops after ${delayLabel(cfg.deadline_hours)}`);
  if (trigger === "checkout_abandoned") out.push("Stops when they buy");
  return out;
}

// ---- Editor helpers ---------------------------------------------------------


export const FLOW_TRIGGERS = ["checkout_abandoned", "order_placed", "customer_created", "segment_entry", "date_based"] as const;
export type FlowTriggerKey = (typeof FLOW_TRIGGERS)[number];

/** Triggers that actually enrol people today (the rest are drafts-only). */
export const LIVE_TRIGGERS: FlowTriggerKey[] = ["checkout_abandoned", "order_placed"];

/** Merge tags the flow engine fills for each trigger. */
export const FLOW_MERGE_TAGS: Record<string, { tag: string; label: string }[]> = {
  checkout_abandoned: [
    { tag: "first_name", label: "First name" },
    { tag: "cart_items", label: "Cart items (table)" },
    { tag: "cart_total", label: "Cart total" },
    { tag: "checkout_url", label: "Recovery link" },
    { tag: "coupon_code", label: "Coupon code" },
  ],
  order_placed: [
    { tag: "first_name", label: "First name" },
    { tag: "cart_items", label: "Order items (table)" },
    { tag: "reorder_url", label: "One-tap reorder link" },
    { tag: "coupon_code", label: "Coupon code" },
  ],
};
const DEFAULT_TAGS = [
  { tag: "first_name", label: "First name" },
  { tag: "coupon_code", label: "Coupon code" },
];
export function mergeTagsFor(trigger: string): { tag: string; label: string }[] {
  return FLOW_MERGE_TAGS[trigger] ?? DEFAULT_TAGS;
}

export type DelayUnit = "minutes" | "hours" | "days";
const UNIT_HOURS: Record<DelayUnit, number> = { minutes: 1 / 60, hours: 1, days: 24 };

/** Pick the friendliest unit for a stored delay (600 h shows as 25 days). */
export function splitDelay(hours: number): { value: number; unit: DelayUnit } {
  const h = Number.isFinite(hours) && hours > 0 ? hours : 0;
  if (h > 0 && h < 1) return { value: Math.round(h * 60), unit: "minutes" };
  if (h >= 24 && Number.isInteger(h / 24)) return { value: h / 24, unit: "days" };
  return { value: Math.round(h * 100) / 100, unit: "hours" };
}
export function joinDelay(value: number, unit: DelayUnit): number {
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  return Math.round(v * UNIT_HOURS[unit] * 10_000) / 10_000;
}

export type EditableStep = {
  type: "email";
  delay_hours: number;
  subject: string;
  preview_text?: string;
  body_html: string;
  coupon_code?: string;
};

export type EditableFlow = {
  name: string;
  description: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  steps: EditableStep[];
};

const CONFIG_KEYS = ["first_order_only", "once_per_contact_days", "exit_on_reorder", "deadline_hours", "coupon_code"] as const;

/** Parse an editor payload into a clean flow row, or an error message. */
export function sanitizeFlow(raw: unknown): EditableFlow | string {
  const b = (raw ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  if (!name) return "Give the automation a name.";
  if (name.length > 120) return "Name is too long.";
  const trigger_type = String(b.trigger_type ?? "");
  if (!(FLOW_TRIGGERS as readonly string[]).includes(trigger_type)) return "Pick a trigger.";

  const cfgIn = (b.trigger_config ?? {}) as Record<string, unknown>;
  const trigger_config: Record<string, unknown> = {};
  for (const k of CONFIG_KEYS) {
    const v = cfgIn[k];
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (k === "first_order_only" || k === "exit_on_reorder") trigger_config[k] = v === true;
    else if (k === "coupon_code") trigger_config[k] = String(v).trim().toUpperCase().slice(0, 40);
    else {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) trigger_config[k] = Math.round(n);
    }
  }

  const stepsIn = Array.isArray(b.steps) ? b.steps : [];
  if (stepsIn.length > 10) return "An automation can have at most 10 emails.";
  const steps: EditableStep[] = [];
  for (const [i, sRaw] of stepsIn.entries()) {
    const s = (sRaw ?? {}) as Record<string, unknown>;
    const delay = Number(s.delay_hours);
    if (!Number.isFinite(delay) || delay < 0 || delay > 24 * 365) return `Email ${i + 1}: the wait must be between 0 and 365 days.`;
    const step: EditableStep = {
      type: "email",
      delay_hours: delay,
      subject: String(s.subject ?? "").trim(),
      body_html: String(s.body_html ?? ""),
    };
    const pv = String(s.preview_text ?? "").trim();
    if (pv) step.preview_text = pv;
    const cc = String(s.coupon_code ?? "").trim().toUpperCase();
    if (cc) step.coupon_code = cc;
    steps.push(step);
  }
  return { name, description: String(b.description ?? "").trim().slice(0, 400), trigger_type, trigger_config, steps };
}

/** Visible text of an email body (tags stripped), for copy checks. */
export function bodyText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Copy + wiring checks. "block" issues stop a save of an ON automation and switching one on. */
export function flowIssues(flow: EditableFlow): Issue[] {
  const out: Issue[] = [];
  if (flow.steps.length === 0) out.push({ level: "block", message: "Add at least one email." });
  if (!(LIVE_TRIGGERS as string[]).includes(flow.trigger_type)) {
    out.push({ level: "warn", message: "Nothing enrols people into this trigger yet, so this automation will not send even when on." });
  }
  const allowed = new Set(mergeTagsFor(flow.trigger_type).map((t) => t.tag));
  flow.steps.forEach((st, i) => {
    const n = `Email ${i + 1}`;
    if (!st.subject) out.push({ level: "block", message: `${n}: add a subject line.` });
    if (!bodyText(st.body_html)) out.push({ level: "block", message: `${n}: the email body is empty.` });
    out.push(...copyIssues(`${n} subject`, st.subject));
    if (st.preview_text) out.push(...copyIssues(`${n} preview text`, st.preview_text));
    out.push(...copyIssues(`${n} body`, bodyText(st.body_html)));
    const used = [st.subject, st.preview_text ?? "", st.body_html].join(" ").match(/\{\{\s*([a-z_]+)\s*\}\}/g) ?? [];
    for (const u of new Set(used)) {
      const tag = u.replace(/[{}\s]/g, "");
      if (!allowed.has(tag)) out.push({ level: "block", message: `${n}: {{${tag}}} is not filled for this trigger, customers would see it raw.` });
    }
    if (/\{\{\s*coupon_code\s*\}\}/.test(st.subject + st.body_html) && !st.coupon_code) {
      out.push({ level: "block", message: `${n}: uses {{coupon_code}} but this email has no coupon set.` });
    }
    if (!st.preview_text) out.push({ level: "warn", message: `${n}: add preview text (the grey line after the subject). It lifts opens.` });
  });
  if (flow.trigger_type === "checkout_abandoned" && !flow.steps.some((st) => /\{\{\s*checkout_url\s*\}\}/.test(st.body_html))) {
    out.push({ level: "warn", message: "No email links to {{checkout_url}}, so nobody can get back to their cart." });
  }
  return out;
}

export function hasBlockingIssue(issues: Issue[]): boolean {
  return issues.some((i) => i.level === "block");
}
