"use client";

// Small building blocks shared by the automation cards and the builder.

import { useId, useState, type ReactNode } from "react";
import { Lock, type LucideIcon } from "lucide-react";
import { WhatsAppPreview } from "../WhatsAppPreview";
import type { Template } from "../types";
import {
  bestUnit, fillBody, friendlyTemplateName, fromUnit, sampleVarsFor, templateStatusText, toUnit,
  type DurationUnit, type TemplateLite,
} from "./logic";
import s from "./flows.module.css";

/* ---------------- switch ---------------- */

export function Switch({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={s.switch} onClick={onClick} disabled={disabled} />
  );
}

/* ---------------- duration input ---------------- */

const UNIT_WORD: Record<DurationUnit, string> = { minutes: "minutes", hours: "hours", days: "days" };

/**
 * Number + unit picker for a duration stored in hours. Shows whole days as
 * days. `min`/`max` are in hours; out-of-range values are reported, not saved.
 */
export function DurationInput({
  hours, onChange, label, units = ["hours", "days"], min, max, disabled,
}: {
  hours: number; onChange: (hours: number) => void; label: string;
  units?: DurationUnit[]; min: number; max: number; disabled?: boolean;
}) {
  const [unit, setUnit] = useState<DurationUnit>(() => bestUnit(hours, units));
  const [text, setText] = useState<string>(() => String(toUnit(hours, bestUnit(hours, units))));
  const [lastHours, setLastHours] = useState(hours);
  const id = useId();
  // Resync when the value changes from outside (discard, reload).
  if (hours !== lastHours) {
    setLastHours(hours);
    const current = Number(text);
    if (!Number.isFinite(current) || fromUnit(current, unit) !== hours) {
      const u = bestUnit(hours, units);
      setUnit(u);
      setText(String(toUnit(hours, u)));
    }
  }
  const n = Number(text);
  const h = fromUnit(n, unit);
  const bad = text.trim() === "" || !Number.isFinite(n) || h < min || h > max;
  const push = (t: string, u: DurationUnit) => {
    const v = Number(t);
    if (t.trim() === "" || !Number.isFinite(v)) return;
    const hh = fromUnit(v, u);
    if (hh >= min && hh <= max) { setLastHours(hh); onChange(hh); }
  };
  return (
    <span className={s.field}>
      <span className={s.dur}>
        <input
          id={id} type="number" inputMode="decimal" className={s.num} value={text} disabled={disabled}
          aria-label={`${label} (${UNIT_WORD[unit]})`} aria-invalid={bad || undefined}
          min={toUnit(min, unit)} max={toUnit(max, unit)} step={unit === "days" ? 1 : unit === "minutes" ? 5 : 0.5}
          onChange={(e) => { setText(e.target.value); push(e.target.value, unit); }}
        />
        {units.length > 1 ? (
          <select
            className={s.select} value={unit} disabled={disabled} aria-label={`${label} unit`}
            onChange={(e) => {
              const u = e.target.value as DurationUnit;
              // keep the same real duration, shown in the new unit
              const cur = fromUnit(Number(text) || 0, unit);
              setUnit(u);
              setText(String(toUnit(cur, u)));
            }}
          >
            {units.map((u) => <option key={u} value={u}>{UNIT_WORD[u]}</option>)}
          </select>
        ) : (
          <span className={s.hint}>{UNIT_WORD[unit]}</span>
        )}
      </span>
      {bad && (
        <span className={s.err} role="alert">
          Pick between {friendlyRange(min, unit)} and {friendlyRange(max, unit)}.
        </span>
      )}
    </span>
  );
}

function friendlyRange(hours: number, unit: DurationUnit): string {
  return `${toUnit(hours, unit)} ${UNIT_WORD[unit]}`;
}

/* ---------------- labelled field ---------------- */

export function Field({ label, help, children }: { label: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}{help}</span>
      {children}
    </div>
  );
}

/* ---------------- stats row ---------------- */

export function StatsRow({ rows, basis = "last 30 days" }: { rows: Array<{ label: string; value: number }>; basis?: string }) {
  return (
    <div className={s.stats}>
      {rows.map((r) => (
        <span key={r.label}><strong>{r.value.toLocaleString("en-IN")}</strong>{r.label}</span>
      ))}
      <span className={s.statsBasis}>{basis}</span>
    </div>
  );
}

/* ---------------- technical disclosure ---------------- */

export function TechDetails({ children }: { children: ReactNode }) {
  return (
    <details className={s.tech}>
      <summary>How this works (technical)</summary>
      <div className={s.techBody}>{children}</div>
    </details>
  );
}

/* ---------------- lock note ---------------- */

export function LockNote({ children }: { children: ReactNode }) {
  return (
    <div className={s.lockNote}>
      <Lock aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/* ---------------- template status ---------------- */

export function TemplateStatus({ name, templates }: { name: string; templates: TemplateLite[] }) {
  const st = templateStatusText(name, templates);
  return <span className={`pm2-pill ${st.tone}`}>{st.text}</span>;
}

/* ---------------- message preview ---------------- */

export function findTemplate(templates: Template[], name: string): Template | undefined {
  const same = templates.filter((t) => t.name === name);
  return same.find((t) => t.status === "approved" && t.language.startsWith("en")) ?? same.find((t) => t.status === "approved") ?? same[0];
}

/**
 * Real WhatsApp preview of a template with sample values in its blanks.
 * `vars` defaults to realistic samples for the built-in templates.
 */
export function MessagePreview({
  name, templates, vars, label, statusRows,
}: {
  name: string; templates: Template[]; vars?: Record<string, string>; label?: string; statusRows?: TemplateLite[];
}) {
  const t = findTemplate(templates, name);
  return (
    <div className={s.preview}>
      <div className={s.previewHead}>
        <span className={s.previewLabel}>{label ?? "What the customer sees"}</span>
      </div>
      <div className={s.tplName}>
        <span>{friendlyTemplateName(name)}</span>
        <TemplateStatus name={name} templates={statusRows ?? templates} />
      </div>
      {t ? (
        <WhatsAppPreview
          headerType={t.header_type}
          headerMediaUrl={t.header_media_url}
          headerText={t.header_text}
          body={fillBody(t.body ?? "", vars ?? sampleVarsFor(name))}
          footer={t.footer}
          buttons={t.buttons}
        />
      ) : (
        <div className={s.hint}>Preview not available: this message is not in the Templates list yet.</div>
      )}
      <span className={s.hint}>Sample customer: Priya, order #1234.</span>
    </div>
  );
}

/** Picker between several message previews (e.g. reminder, then coupon). */
export function PreviewTabs({ items, templates, statusRows }: {
  items: Array<{ key: string; label: string; name: string; vars?: Record<string, string> }>;
  templates: Template[];
  statusRows?: TemplateLite[];
}) {
  const [at, setAt] = useState(0);
  const cur = items[Math.min(at, items.length - 1)];
  if (!cur) return null;
  return (
    <div className={s.preview}>
      {items.length > 1 && (
        <div className="pm2-seg" role="group" aria-label="Which message to preview">
          {items.map((it, i) => (
            <button key={it.key} type="button" className={i === at ? "on" : ""} aria-pressed={i === at} onClick={() => setAt(i)}>
              {it.label}
            </button>
          ))}
        </div>
      )}
      <MessagePreview name={cur.name} vars={cur.vars} templates={templates} statusRows={statusRows} />
    </div>
  );
}

export type IconType = LucideIcon;
