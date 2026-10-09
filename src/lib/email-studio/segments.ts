// Audience rules for Email Studio. A segment is a list of plain conditions
// ("orders at least 2", "last order more than 90 days ago", ...) that ALL must
// match. Matching is a pure function over contact rows, so the count shown in
// the builder and the list the sender uses come from the same code.
//
// The base audience is not optional: email present, status active, marketing
// consent given, not on the suppression list (AGENTS.md §4.4 + consent rule).
//
// Keep imports relative: vitest has no "@/" alias.

export type Condition =
  | { field: "total_orders"; op: "gte" | "lte" | "eq"; value: number }
  | { field: "total_spent"; op: "gte" | "lte"; value: number }
  | { field: "last_order_days"; op: "within" | "before"; value: number }
  | { field: "first_order_days"; op: "within" | "before"; value: number }
  | { field: "never_ordered"; op: "is"; value: boolean }
  | { field: "city"; op: "is"; value: string }
  | { field: "state"; op: "is"; value: string }
  | { field: "tag"; op: "has" | "not"; value: string }
  | { field: "engaged_days"; op: "within" | "not_within"; value: number }
  | { field: "bought"; op: "has" | "not"; value: string };

export type AudienceRules = { conditions: Condition[] };

export type AudienceContact = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  accepts_marketing: boolean | null;
  email_consent: string | null;
  total_orders: number | null;
  total_spent: number | string | null;
  first_purchase_date: string | null;
  last_purchase_date: string | null;
  city: string | null;
  state: string | null;
  tags: string[] | null;
};

/** Extra lookups some conditions need (built only when a rule asks for them). */
export type MatchContext = {
  now: number;
  suppressed: Set<string>;
  /** contact ids that opened/clicked, keyed by the engaged_days window. */
  engaged?: Map<number, Set<string>>;
  /** lower-cased emails of buyers, keyed by the lower-cased product text. */
  buyers?: Map<string, Set<string>>;
};

export const PRESETS: Record<string, { label: string; hint: string; rules: AudienceRules }> = {
  all: { label: "Everyone subscribed", hint: "All consented subscribers", rules: { conditions: [] } },
  customers: {
    label: "Customers",
    hint: "Ordered at least once",
    rules: { conditions: [{ field: "total_orders", op: "gte", value: 1 }] },
  },
  vip: {
    label: "VIPs",
    hint: "3 or more orders",
    rules: { conditions: [{ field: "total_orders", op: "gte", value: 3 }] },
  },
  new: {
    label: "New customers",
    hint: "First order in the last 30 days",
    rules: { conditions: [{ field: "first_order_days", op: "within", value: 30 }] },
  },
  lapsed: {
    label: "Lapsed customers",
    hint: "Ordered before, nothing in 90 days",
    rules: {
      conditions: [
        { field: "total_orders", op: "gte", value: 1 },
        { field: "last_order_days", op: "before", value: 90 },
      ],
    },
  },
  engaged: {
    label: "Engaged",
    hint: "Opened or clicked in the last 90 days",
    rules: { conditions: [{ field: "engaged_days", op: "within", value: 90 }] },
  },
  prospects: {
    label: "Never ordered",
    hint: "Subscribed but no order yet",
    rules: { conditions: [{ field: "never_ordered", op: "is", value: true }] },
  },
};

export const FIELD_LABELS: Record<Condition["field"], string> = {
  total_orders: "Number of orders",
  total_spent: "Total spent (₹)",
  last_order_days: "Last order",
  first_order_days: "First order",
  never_ordered: "Never ordered",
  city: "City",
  state: "State",
  tag: "Tag",
  engaged_days: "Opened or clicked an email",
  bought: "Bought a product (name contains)",
};

/** Legacy campaigns.segment_filter → rules (keeps old drafts working). */
export function rulesFromLegacy(filter: unknown): AudienceRules {
  const f = (filter && typeof filter === "object" ? filter : {}) as Record<string, unknown>;
  const preset = typeof f.audience === "string" && PRESETS[f.audience] ? PRESETS[f.audience].rules : PRESETS.all.rules;
  const conditions: Condition[] = [...preset.conditions];
  if (typeof f.min_orders === "number") conditions.push({ field: "total_orders", op: "gte", value: f.min_orders });
  if (typeof f.min_spent === "number") conditions.push({ field: "total_spent", op: "gte", value: f.min_spent });
  if (Array.isArray(f.tags)) for (const t of f.tags) if (typeof t === "string") conditions.push({ field: "tag", op: "has", value: t });
  return { conditions };
}

const FIELDS = new Set(Object.keys(FIELD_LABELS));

/** Validate untrusted rules; drops malformed conditions. */
export function parseRules(raw: unknown): AudienceRules {
  const list = raw && typeof raw === "object" && Array.isArray((raw as AudienceRules).conditions) ? (raw as AudienceRules).conditions : [];
  const conditions: Condition[] = [];
  for (const c of list.slice(0, 20)) {
    if (!c || typeof c !== "object" || !FIELDS.has(String(c.field))) continue;
    const v = (c as { value: unknown }).value;
    switch (c.field) {
      case "total_orders":
      case "total_spent":
      case "last_order_days":
      case "first_order_days":
      case "engaged_days": {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) conditions.push({ ...c, value: n } as Condition);
        break;
      }
      case "never_ordered":
        conditions.push({ field: "never_ordered", op: "is", value: v !== false });
        break;
      default:
        if (typeof v === "string" && v.trim()) conditions.push({ ...c, value: v.trim() } as Condition);
    }
  }
  return { conditions };
}

export function isConsented(c: AudienceContact): boolean {
  return c.accepts_marketing === true || String(c.email_consent ?? "").toUpperCase() === "SUBSCRIBED";
}

/** The non-negotiable base: reachable, active, consented, not suppressed. */
export function inBaseAudience(c: AudienceContact, suppressed: Set<string>): boolean {
  if (!c.email || !c.email.includes("@")) return false;
  if (c.status !== "active") return false;
  if (!isConsented(c)) return false;
  return !suppressed.has(c.email.toLowerCase());
}

function daysAgo(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now - t) / 86_400_000 : null;
}

function same(a: string | null, b: string): boolean {
  return !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function matchesCondition(c: AudienceContact, cond: Condition, ctx: MatchContext): boolean {
  const orders = Number(c.total_orders ?? 0);
  switch (cond.field) {
    case "total_orders":
      return cond.op === "gte" ? orders >= cond.value : cond.op === "lte" ? orders <= cond.value : orders === cond.value;
    case "total_spent": {
      const s = Number(c.total_spent ?? 0);
      return cond.op === "gte" ? s >= cond.value : s <= cond.value;
    }
    case "last_order_days":
    case "first_order_days": {
      const d = daysAgo(cond.field === "last_order_days" ? c.last_purchase_date : c.first_purchase_date, ctx.now);
      if (d == null) return false;
      return cond.op === "within" ? d <= cond.value : d > cond.value;
    }
    case "never_ordered":
      return cond.value ? orders === 0 : orders > 0;
    case "city":
      return same(c.city, cond.value);
    case "state":
      return same(c.state, cond.value);
    case "tag": {
      const has = (c.tags ?? []).some((t) => same(t, cond.value));
      return cond.op === "has" ? has : !has;
    }
    case "engaged_days": {
      const set = ctx.engaged?.get(cond.value);
      const hit = !!set?.has(c.id);
      return cond.op === "within" ? hit : !hit;
    }
    case "bought": {
      const set = ctx.buyers?.get(cond.value.toLowerCase());
      const hit = !!c.email && !!set?.has(c.email.toLowerCase());
      return cond.op === "has" ? hit : !hit;
    }
  }
}

export function matchesAudience(c: AudienceContact, rules: AudienceRules, ctx: MatchContext): boolean {
  return inBaseAudience(c, ctx.suppressed) && rules.conditions.every((cond) => matchesCondition(c, cond, ctx));
}

/** How many contacts each audience matches, in one pass over the contacts. */
export function countMatching(contacts: AudienceContact[], list: AudienceRules[], ctx: MatchContext): number[] {
  const out = list.map(() => 0);
  for (const c of contacts) list.forEach((rules, i) => { if (matchesAudience(c, rules, ctx)) out[i]++; });
  return out;
}

/** Plain-English one-liner for a condition (review step, segment list). */
export function describeCondition(c: Condition): string {
  switch (c.field) {
    case "total_orders":
      return `${c.op === "gte" ? "at least" : c.op === "lte" ? "at most" : "exactly"} ${c.value} order${c.value === 1 ? "" : "s"}`;
    case "total_spent":
      return `spent ${c.op === "gte" ? "at least" : "at most"} ₹${c.value}`;
    case "last_order_days":
      return c.op === "within" ? `ordered in the last ${c.value} days` : `no order in the last ${c.value} days`;
    case "first_order_days":
      return c.op === "within" ? `first order in the last ${c.value} days` : `first order more than ${c.value} days ago`;
    case "never_ordered":
      return c.value ? "never ordered" : "has ordered";
    case "city":
      return `city is ${c.value}`;
    case "state":
      return `state is ${c.value}`;
    case "tag":
      return c.op === "has" ? `tagged "${c.value}"` : `not tagged "${c.value}"`;
    case "engaged_days":
      return c.op === "within" ? `opened or clicked in the last ${c.value} days` : `no opens or clicks in the last ${c.value} days`;
    case "bought":
      return c.op === "has" ? `bought "${c.value}"` : `never bought "${c.value}"`;
  }
}

export function describeRules(r: AudienceRules): string {
  if (r.conditions.length === 0) return "Everyone subscribed";
  return r.conditions.map(describeCondition).join(" and ");
}
