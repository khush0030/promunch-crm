"use client";

// Shared bits for the influencer tracker: labels, date formatting, the health
// chip, the drawer shell, small form controls and the data hooks every tab
// reads from.

import { useEffect, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Pill, type BadgeTone, type PillTone } from "@/components/pm";
import type {
  BoardSummary,
  DealHealth,
  DealListItem,
  DealStage,
  InfluencerListItem,
  InfluencerSettings,
  InfluencerTier,
  Kit,
  KitRule,
  StageGroup,
  UsageRights,
} from "@/lib/influencers/types";
import { api, ApiError, QK, unwrap } from "./api";
import s from "../influencers.module.css";

// ── labels ──────────────────────────────────────────────────────────────────

export const HEALTH_LABEL: Record<DealHealth, string> = {
  overdue: "Overdue",
  at_risk: "At risk",
  waiting_on_us: "Waiting on us",
  on_track: "On track",
  closed: "Closed",
};

export const HEALTH_TONE: Record<DealHealth, BadgeTone> = {
  overdue: "terra",
  at_risk: "gold",
  waiting_on_us: "blue",
  on_track: "green",
  closed: "gray",
};

/** Status as coloured text + dot (redesign rule: never a filled block). */
export const HEALTH_PILL: Record<DealHealth, PillTone> = {
  overdue: "crit",
  at_risk: "warn",
  waiting_on_us: "info",
  on_track: "good",
  closed: "neu",
};

/** Map the older BadgeTone palette onto the dot pills. */
export const TONE_PILL: Record<BadgeTone, PillTone> = {
  green: "good",
  gold: "warn",
  terra: "crit",
  blue: "info",
  gray: "neu",
};

export const STAGE_LABEL: Record<DealStage, string> = {
  agreed: "Agreed",
  brief_draft: "Brief in progress",
  brief_sent: "Brief sent",
  brief_acknowledged: "Brief accepted",
  dispatched: "Box shipped",
  delivered: "Box arrived",
  draft_submitted: "Draft to review",
  changes_requested: "Changes asked",
  draft_approved: "Draft approved",
  posted: "Posted",
  completed: "Completed",
  cancelled: "Cancelled",
  ghosted: "Ghosted",
};

export const GROUPS: { key: StageGroup; label: string; dot: string }[] = [
  { key: "briefing", label: "Briefing", dot: "var(--pm-blue)" },
  { key: "shipping", label: "Shipping", dot: "var(--pm-gold)" },
  { key: "creating", label: "Creating", dot: "var(--pm-orange)" },
  { key: "review", label: "Review", dot: "var(--pm-brand)" },
  { key: "live", label: "Live", dot: "var(--pm-green)" },
  { key: "done", label: "Done", dot: "var(--pm-hint)" },
];

export const TIER_LABEL: Record<InfluencerTier, string> = {
  nano: "Nano",
  micro: "Micro",
  mid: "Mid",
  macro: "Macro",
};

export const USAGE_LABEL: Record<UsageRights, string> = {
  none: "None",
  organic_repost: "Organic repost",
  partnership_ads: "Partnership ads",
};

export const NICHES = ["fitness", "food", "lifestyle", "health", "student", "parenting", "comedy", "sports", "travel"];

// ── formatting ──────────────────────────────────────────────────────────────

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "today", "tomorrow", "in 3 days", "2 days ago". */
export function relDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const diff = Math.round((startOfDay(t) - startOfDay(new Date())) / DAY);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso);
  return !Number.isNaN(t.getTime()) && startOfDay(t) === startOfDay(new Date());
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** ISO → yyyy-mm-dd for <input type="date">. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function compact(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function pct(n: number | null | undefined): string {
  if (n == null) return "";
  return `${Number(n).toFixed(1).replace(/\.0$/, "")}%`;
}

// ── small components ────────────────────────────────────────────────────────

export function HealthChip({ health, reason }: { health: DealHealth; reason?: string | null }) {
  return (
    <span title={reason ?? undefined} style={{ display: "inline-flex" }}>
      <Pill tone={HEALTH_PILL[health]}>{HEALTH_LABEL[health]}</Pill>
    </span>
  );
}

/**
 * Phone-only sort control. At <=760px the table head is hidden (rows stack),
 * so the sortable column headers go with it; this select drives the SAME
 * `pick` handler the header buttons call.
 */
export function SortPicker<K extends string>({
  options,
  sort,
  pick,
}: {
  options: { key: K; label: string }[];
  sort: { key: K; dir: 1 | -1 };
  pick: (key: K) => void;
}) {
  return (
    <div className={s.sortPhone}>
      <label className={s.sortPhoneL}>
        Sort by
        <select className={s.select} value={sort.key} onChange={(e) => pick(e.target.value as K)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={s.sortDir}
        onClick={() => pick(sort.key)}
        aria-label={sort.dir === 1 ? "Ascending, tap to reverse" : "Descending, tap to reverse"}
      >
        {sort.dir === 1 ? "↑ Ascending" : "↓ Descending"}
      </button>
    </div>
  );
}

export function TierTag({ tier }: { tier: InfluencerTier | null }) {
  if (!tier) return null;
  return <span className={s.tier}>{TIER_LABEL[tier]}</span>;
}

export function Initial({ handle, large }: { handle: string; large?: boolean }) {
  return (
    <span className={`${s.initial}${large ? ` ${s.initialLg}` : ""}`} aria-hidden="true">
      {(handle.replace(/^@/, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function at(handle: string): string {
  return handle.startsWith("@") ? handle : `@${handle}`;
}

export function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={s.switch}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      {children}
      {hint != null && <span className={s.hint}>{hint}</span>}
    </label>
  );
}

export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 20,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <span className={s.stepperIn} role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span>{value}</span>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  );
}

/** Editable list of short strings (hooks, must-say, checklist...). */
export function ListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className={s.listEdit}>
      {items.map((it, i) => (
        <div className={s.listEditRow} key={i}>
          <input
            className={s.input}
            value={it}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            className="pm-btn ghost sm"
            aria-label="Remove"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="pm-btn ghost sm" onClick={() => onChange([...items, ""])}>
          + Add line
        </button>
      </div>
    </div>
  );
}

export function Drawer({
  onClose,
  children,
  width = 680,
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number;
  label: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A ConfirmDialog on top handles its own Escape.
      if (e.key === "Escape" && !document.querySelector(".pm2-dialog")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={s.backdrop} onClick={onClose}>
      <div
        className={s.drawer}
        style={{ width: `min(${width}px, 100vw)` }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="pm-btn ghost sm" onClick={onClose} aria-label="Close">
      <X size={15} />
    </button>
  );
}

export function Section({
  title,
  icon,
  right,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <h3 className={s.sectionTitle}>
          {icon}
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function ErrLine({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return <p className={s.err} style={{ margin: "6px 0 0" }}>{msg}</p>;
}

// ── data hooks ──────────────────────────────────────────────────────────────

/** Board list. `filters` maps to the API's ?health= / ?stage= / ?group= (comma lists). */
export function useDeals(filters: { health?: string[]; stage?: string[]; group?: string[] } = {}) {
  const sp = new URLSearchParams();
  if (filters.health?.length) sp.set("health", filters.health.join(","));
  if (filters.stage?.length) sp.set("stage", filters.stage.join(","));
  if (filters.group?.length) sp.set("group", filters.group.join(","));
  const qs = sp.toString();
  return useQuery({
    queryKey: [...QK.deals, qs],
    queryFn: async () =>
      unwrap<DealListItem[]>(await api(`/api/influencers/deals${qs ? `?${qs}` : ""}`), "deals", []),
    refetchInterval: 120_000,
  });
}

export function useSummary() {
  return useQuery({
    queryKey: QK.summary,
    queryFn: async () => unwrap<BoardSummary | null>(await api("/api/influencers/summary"), "summary", null),
    refetchInterval: 120_000,
  });
}

export function useKits() {
  return useQuery({
    queryKey: QK.kits,
    queryFn: async () => unwrap<Kit[]>(await api("/api/influencers/kits"), "kits", []),
  });
}

export function useKitRules() {
  return useQuery({
    queryKey: QK.rules,
    queryFn: async () => unwrap<KitRule[]>(await api("/api/influencers/kit-rules"), "rules", []),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: QK.settings,
    queryFn: async () => unwrap<InfluencerSettings | null>(await api("/api/influencers/settings"), "settings", null),
  });
}

export function useCreators() {
  return useQuery({
    queryKey: QK.creators,
    queryFn: async () => unwrap<InfluencerListItem[]>(await api("/api/influencers"), "influencers", []),
  });
}

/** Shared mutation for every deal drawer action: call, then refresh deal + board. */
export function useDealAction(dealId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { url: string; method?: string; body?: unknown }) => {
      try {
        return await api<Record<string, unknown>>(a.url, { method: a.method ?? "POST", body: a.body });
      } catch (e) {
        // PATCH /deals/[id] is compare-and-set on stage: someone else moved
        // the collab first. Say so plainly and pull the fresh copy.
        if (e instanceof ApiError && e.status === 409 && a.method === "PATCH" && a.url === `/api/influencers/deals/${dealId}`) {
          qc.invalidateQueries({ queryKey: QK.deal(dealId) });
          qc.invalidateQueries({ queryKey: QK.deals });
          throw new ApiError("This collab changed, refreshing.", 409);
        }
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.deal(dealId) });
      qc.invalidateQueries({ queryKey: QK.deals });
      qc.invalidateQueries({ queryKey: QK.summary });
    },
  });
}
