"use client";

// Plain-English audience rules with a live count. Used on the campaign
// Audience step and the Audiences page. Consent + suppression are always
// applied on the server; the count shown is exactly who would get the email.

import { useEffect, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { FIELD_LABELS, type AudienceRules, type Condition } from "@/lib/email-studio/segments";
import { sendJson } from "./api";
import s from "./studio.module.css";

type Field = Condition["field"];
const FIELD_ORDER: Field[] = [
  "total_orders", "total_spent", "last_order_days", "first_order_days", "never_ordered",
  "engaged_days", "bought", "city", "state", "tag",
];

const OPS: Record<Field, { v: string; label: string }[]> = {
  total_orders: [{ v: "gte", label: "at least" }, { v: "lte", label: "at most" }, { v: "eq", label: "exactly" }],
  total_spent: [{ v: "gte", label: "at least ₹" }, { v: "lte", label: "at most ₹" }],
  last_order_days: [{ v: "within", label: "within the last (days)" }, { v: "before", label: "more than (days) ago" }],
  first_order_days: [{ v: "within", label: "within the last (days)" }, { v: "before", label: "more than (days) ago" }],
  never_ordered: [{ v: "is", label: "is" }],
  engaged_days: [{ v: "within", label: "in the last (days)" }, { v: "not_within", label: "not in the last (days)" }],
  bought: [{ v: "has", label: "has bought" }, { v: "not", label: "has never bought" }],
  city: [{ v: "is", label: "is" }],
  state: [{ v: "is", label: "is" }],
  tag: [{ v: "has", label: "has tag" }, { v: "not", label: "does not have tag" }],
};

function defaultCondition(field: Field): Condition {
  switch (field) {
    case "total_orders": return { field, op: "gte", value: 1 };
    case "total_spent": return { field, op: "gte", value: 500 };
    case "last_order_days": return { field, op: "within", value: 90 };
    case "first_order_days": return { field, op: "within", value: 30 };
    case "never_ordered": return { field, op: "is", value: true };
    case "engaged_days": return { field, op: "within", value: 90 };
    case "bought": return { field, op: "has", value: "Edamame" };
    case "city": return { field, op: "is", value: "Indore" };
    case "state": return { field, op: "is", value: "Madhya Pradesh" };
    case "tag": return { field, op: "has", value: "" };
  }
}

const NUMERIC = new Set<Field>(["total_orders", "total_spent", "last_order_days", "first_order_days", "engaged_days"]);

export function useAudienceCount(rules: AudienceRules | null) {
  const [state, setState] = useState<{ count: number | null; sample: string[]; loading: boolean; error: string | null }>({
    count: null,
    sample: [],
    loading: false,
    error: null,
  });
  const key = JSON.stringify(rules);
  useEffect(() => {
    if (!rules) return;
    let alive = true;
    setState((x) => ({ ...x, loading: true, error: null }));
    const t = setTimeout(() => {
      sendJson<{ count: number; sample: string[] }>("/api/email-studio/segments/count", "POST", { rules })
        .then((r) => alive && setState({ count: r.count, sample: r.sample, loading: false, error: null }))
        .catch((e) => alive && setState({ count: null, sample: [], loading: false, error: e.message }));
    }, 450);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function AudienceCount({ rules }: { rules: AudienceRules }) {
  const { count, sample, loading, error } = useAudienceCount(rules);
  return (
    <div className="pm2-panel" style={{ padding: 16, display: "grid", gap: 6 }}>
      <div className={s.row} style={{ color: "var(--pm-muted)", fontSize: 13 }}>
        <Users size={15} /> Who gets this email
      </div>
      <div className={s.bigCount} style={{ opacity: loading ? 0.5 : 1 }}>{count == null ? "…" : count.toLocaleString("en-IN")}</div>
      <div className={s.hint}>
        {error ? <span style={{ color: "var(--pm-terra)" }}>{error}</span> : "subscribed people with an email address, after removing unsubscribes and bounces"}
      </div>
      {sample.length > 0 && <div className={s.hint}>For example: {sample.join(", ")}</div>}
    </div>
  );
}

export function SegmentEditor({ rules, onChange }: { rules: AudienceRules; onChange: (r: AudienceRules) => void }) {
  const conds = rules.conditions;
  const set = (i: number, c: Condition) => onChange({ conditions: conds.map((x, j) => (j === i ? c : x)) });
  return (
    <div className={s.stack}>
      {conds.length === 0 && <div className={s.hint}>No filters: everyone subscribed. Add a filter to narrow it down.</div>}
      {conds.map((c, i) => (
        <div key={i} className={s.cond}>
          <select className={s.select} value={c.field} onChange={(e) => set(i, defaultCondition(e.target.value as Field))}>
            {FIELD_ORDER.map((f) => (
              <option key={f} value={f}>{FIELD_LABELS[f]}</option>
            ))}
          </select>
          <select className={s.select} value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value } as Condition)}>
            {OPS[c.field].map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
          {c.field === "never_ordered" ? (
            <select className={s.select} value={c.value ? "yes" : "no"} onChange={(e) => set(i, { ...c, value: e.target.value === "yes" })}>
              <option value="yes">yes</option>
              <option value="no">no (has ordered)</option>
            </select>
          ) : NUMERIC.has(c.field) ? (
            <input
              className={s.input}
              type="number"
              min={0}
              value={String(c.value)}
              onChange={(e) => set(i, { ...c, value: Math.max(0, Number(e.target.value) || 0) } as Condition)}
            />
          ) : (
            <input className={s.input} value={String(c.value)} onChange={(e) => set(i, { ...c, value: e.target.value } as Condition)} />
          )}
          <button type="button" className={s.iconBtn} onClick={() => onChange({ conditions: conds.filter((_, j) => j !== i) })} aria-label="Remove filter">
            <Trash2 />
          </button>
        </div>
      ))}
      <div className={s.row}>
        <button type="button" className="pm2-btn sm" onClick={() => onChange({ conditions: [...conds, defaultCondition("total_orders")] })}>
          <Plus size={14} /> Add filter
        </button>
        {conds.length > 1 && <span className={s.hint}>People must match every filter.</span>}
      </div>
    </div>
  );
}
