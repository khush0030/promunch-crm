"use client";

import type { ReactNode } from "react";
import { SectionTabs } from "@/components/shell/SectionTabs";
import s from "./insights.module.css";

// Insights page header: eyebrow, display title, one plain-words summary
// sentence built from real data, the actions (period picker, sync), then the
// section tabs (Sales · Web store · Amazon) and optional sub-tabs.
export function InsightsHead({
  title,
  summary,
  actions,
  tabs,
  activeTab,
  onTab,
}: {
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  tabs?: { label: string; key: string; count?: number | string }[];
  activeTab?: string;
  onTab?: (key: string) => void;
}) {
  return (
    <>
      <header className={s.ph}>
        <div className={s.phText}>
          <span className={s.eyebrow}>★ Insights</span>
          <h1 className={s.title}>{title}</h1>
          {summary != null && <p className={s.sum}>{summary}</p>}
        </div>
        {actions != null && <div className={s.acts}>{actions}</div>}
      </header>
      <SectionTabs />
      {tabs != null && tabs.length > 0 && (
        <div className="pm2-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === activeTab}
              className={t.key === activeTab ? "on" : undefined}
              onClick={() => onTab?.(t.key)}
            >
              {t.label}
              {t.count != null && <em>{t.count}</em>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// "▲ 14%" / "▼ 3%" / "±0%" as coloured text. `invert` flips the colour for
// figures where down is good. `unit` "pts" for percentage-point changes.
export function DeltaText({
  value,
  invert = false,
  unit = "%",
}: {
  value: number | null | undefined;
  invert?: boolean;
  unit?: "%" | "pts";
}) {
  if (value == null || !Number.isFinite(value)) return null;
  const r = Math.round(value);
  const good = invert ? r < 0 : r > 0;
  const cls = r === 0 ? s.flat : good ? s.up : s.down;
  const u = unit === "pts" ? " pts" : "%";
  const txt = r === 0 ? `±0${u}` : `${r > 0 ? "▲" : "▼"} ${Math.abs(r)}${u}`;
  return <span className={cls}>{txt}</span>;
}

// A product name short enough for a one-line takeaway: cut at a word
// boundary near `max` characters.
export function shortName(name: string, max = 28): string {
  const n = name.trim();
  if (n.length <= max) return n;
  const cut = n.slice(0, max + 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 12 ? cut.slice(0, sp) : n.slice(0, max)).replace(/[\s,.|(-]+$/, "")}…`;
}

// "−₹29,473" for negatives, "₹10,753" otherwise.
export function signedINR(n: number): string {
  const v = `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
  return n < 0 ? `−${v}` : v;
}

// "up 14%" / "down 3%" / "level" for takeaways and summaries.
export function changeWords(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const r = Math.round(value);
  if (r === 0) return "level";
  return `${r > 0 ? "up" : "down"} ${Math.abs(r)}%`;
}

export function Kpi({
  label,
  value,
  children,
  hero = false,
  red = false,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  children?: ReactNode;
  hero?: boolean;
  red?: boolean;
  title?: string;
}) {
  return (
    <div className={`${s.kpi}${hero ? ` ${s.hero}` : ""}`} title={title}>
      <span className={s.kpiL}>{label}</span>
      <span className={`${s.kpiV}${red ? ` ${s.red}` : ""}`}>{value}</span>
      {children != null && <span className={s.kpiD}>{children}</span>}
    </div>
  );
}

export function ChartCard({
  title,
  basis,
  right,
  takeaway,
  children,
  id,
}: {
  title: ReactNode;
  basis?: ReactNode;
  right?: ReactNode;
  takeaway?: ReactNode;
  children?: ReactNode;
  id: string;
}) {
  return (
    <section className={s.card} aria-labelledby={id}>
      <div className={s.secT}>
        <h3 id={id}>{title}</h3>
        {basis != null && <span className={s.basis}>{basis}</span>}
        {right}
      </div>
      {takeaway != null && <p className={s.takeaway}>{takeaway}</p>}
      {children}
    </section>
  );
}
