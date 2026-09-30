// Plain-words helpers for the Email Studio Automations page. Pure, so the
// list route and tests share them. Keep imports relative: vitest has no "@/".

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
