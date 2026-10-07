"use client";

// Board tab: the "what needs doing" strip, then every collab as a kanban
// (one column per stage group) or a sortable table.

import { useMemo, useState } from "react";
import { BellOff, LayoutGrid, List, Sparkles } from "lucide-react";
import { EmptyState, SearchBar } from "@/components/pm";
import {
  STAGE_GROUP,
  type BoardSummary,
  type DealHealth,
  type DealListItem,
  type DealStage,
  type InfluencerTier,
} from "@/lib/influencers/types";
import { errText } from "./api";
import {
  GROUPS,
  HEALTH_LABEL,
  HealthChip,
  Initial,
  STAGE_LABEL,
  TIER_LABEL,
  at,
  compact,
  isToday,
  relDay,
  shortDate,
  useDeals,
  useSettings,
  useSummary,
} from "./ui";
import s from "../influencers.module.css";

type StripKey = keyof BoardSummary;

const STRIP: { key: StripKey; label: string }[] = [
  { key: "drafts_to_review", label: "Drafts to review" },
  { key: "briefs_to_approve", label: "Briefs to approve" },
  { key: "kits_to_ship", label: "Kits to ship" },
  { key: "waiting_on_us", label: "Waiting on us" },
  { key: "overdue", label: "Overdue" },
  { key: "at_risk", label: "At risk" },
  { key: "due_today", label: "Due today" },
];

// What clicking a strip tile shows. Health and stage filters go to the API
// (?health= / ?stage=); "due today" and "no order yet" are refined here.
function stripFilters(key: StripKey | null): { health?: DealHealth[]; stage?: DealStage[] } {
  switch (key) {
    case "overdue":
    case "at_risk":
    case "waiting_on_us":
      return { health: [key] };
    case "briefs_to_approve":
      return { stage: ["agreed", "brief_draft"] };
    case "drafts_to_review":
      return { stage: ["draft_submitted"] };
    case "kits_to_ship":
      return { stage: ["brief_acknowledged"] };
    default:
      return {};
  }
}

function clientStrip(d: DealListItem, key: StripKey | null): boolean {
  if (key === "due_today") return isToday(d.next_date?.at);
  if (key === "kits_to_ship") return !d.shopify_order_id;
  return true;
}

const HEALTH_RANK: Record<DealHealth, number> = { overdue: 0, at_risk: 1, waiting_on_us: 2, on_track: 3, closed: 4 };

type SortKey = "handle" | "tier" | "stage" | "health" | "next" | "kit";

export function BoardTab({ onOpenDeal, onAdd }: { onOpenDeal: (id: string) => void; onAdd: () => void }) {

  const summary = useSummary();
  const settings = useSettings();

  const [view, setView] = useState<"board" | "list">("board");
  const [strip, setStrip] = useState<StripKey | null>(null);
  const [health, setHealth] = useState<DealHealth | "all">("all");
  const [tier, setTier] = useState<InfluencerTier | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "health", dir: 1 });

  const sf = stripFilters(strip);
  const deals = useDeals({
    health: sf.health ?? (health !== "all" ? [health] : undefined),
    stage: sf.stage,
  });
  const anyFilter = !!strip || health !== "all" || tier !== "all" || !!q.trim();
  const all = useMemo(() => deals.data ?? [], [deals.data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^@/, "");
    return all.filter((d) => {
      if (!clientStrip(d, strip)) return false;
      if (health !== "all" && d.health !== health) return false;
      if (tier !== "all" && d.influencer.tier !== tier) return false;
      if (
        needle &&
        ![d.influencer.handle, d.influencer.full_name, d.kit?.name, d.code]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(needle))
      )
        return false;
      return true;
    });
  }, [all, strip, health, tier, q]);

  const sorted = useMemo(() => {
    const val = (d: DealListItem): string | number => {
      switch (sort.key) {
        case "handle":
          return d.influencer.handle.toLowerCase();
        case "tier":
          return d.influencer.tier ?? "";
        case "stage":
          return GROUPS.findIndex((g) => g.key === STAGE_GROUP[d.stage]);
        case "health":
          return HEALTH_RANK[d.health];
        case "next":
          return d.next_date?.at ?? "9999";
        case "kit":
          return d.kit?.name ?? "";
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return (a.next_date?.at ?? "9999").localeCompare(b.next_date?.at ?? "9999");
    });
  }, [filtered, sort]);

  const sum = summary.data;
  const engineOff = settings.data ? !settings.data.engine_enabled : false;

  const th = (key: SortKey, label: string) => (
    <th
      className={s.sortTh}
      onClick={() => setSort((p) => ({ key, dir: p.key === key ? (p.dir === 1 ? -1 : 1) : 1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  const count = (k: StripKey) => (sum ? sum[k] : summary.isLoading ? "…" : "–");
  const needs = sum ? sum.briefs_to_approve + sum.drafts_to_review + sum.kits_to_ship : null;
  const toggle = (k: StripKey) => setStrip(strip === k ? null : k);

  return (
    <>
      {engineOff && (
        <p className={s.note} role="status">
          <BellOff size={16} />
          <span>
            <b>Automatic reminders are off.</b> Nothing is sent to creators until you switch them on in Settings.
          </span>
        </p>
      )}

      <div className={s.kpis}>
        <div className={s.kpi}>
          <span className={s.kpiL}>Needs you</span>
          <span className={s.kpiV}>{needs ?? count("drafts_to_review")}</span>
          <span className={s.kpiD}>
            {sum
              ? `Drafts ${sum.drafts_to_review} · briefs ${sum.briefs_to_approve} · boxes ${sum.kits_to_ship}`
              : "Drafts, briefs and boxes"}
          </span>
        </div>
        <button
          type="button"
          className={`${s.kpi} ${strip === "overdue" ? s.kpiOn : ""}`}
          aria-pressed={strip === "overdue"}
          title={strip === "overdue" ? "Click again to show everything" : "Show only: Overdue"}
          onClick={() => toggle("overdue")}
        >
          <span className={s.kpiL}>Overdue</span>
          <span className={s.kpiV}>{count("overdue")}</span>
          <span className={s.kpiD}>{sum ? `${sum.at_risk} at risk` : "Creators running late"}</span>
        </button>
        <button
          type="button"
          className={`${s.kpi} ${strip === "due_today" ? s.kpiOn : ""}`}
          aria-pressed={strip === "due_today"}
          title={strip === "due_today" ? "Click again to show everything" : "Show only: Due today"}
          onClick={() => toggle("due_today")}
        >
          <span className={s.kpiL}>Due today</span>
          <span className={s.kpiV}>{count("due_today")}</span>
          <span className={s.kpiD}>{sum ? `${sum.waiting_on_us} waiting on us` : "Drafts and posts"}</span>
        </button>
      </div>

      <div className={s.chips} role="group" aria-label="Show">
        <button
          type="button"
          className={`${s.chip} ${strip === null ? s.chipOn : ""}`}
          aria-pressed={strip === null}
          onClick={() => setStrip(null)}
        >
          All
        </button>
        {STRIP.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${s.chip} ${strip === t.key ? s.chipOn : ""}`}
            aria-pressed={strip === t.key}
            title={strip === t.key ? "Click again to show everything" : `Show only: ${t.label}`}
            onClick={() => toggle(t.key)}
          >
            {t.label} <em>{count(t.key)}</em>
          </button>
        ))}
      </div>

      <div className={s.filters}>
        <div className={s.seg}>
          <button
            type="button"
            className={`${s.segBtn} ${view === "board" ? s.segOn : ""}`}
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            <LayoutGrid size={13} /> Board
          </button>
          <button
            type="button"
            className={`${s.segBtn} ${view === "list" ? s.segOn : ""}`}
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={13} /> List
          </button>
        </div>
        <span className={s.spacer} />
        <SearchBar value={q} onChange={setQ} placeholder="Search creators…" />
        <select
          className={s.select}
          aria-label="Filter by health"
          value={health}
          onChange={(e) => setHealth(e.target.value as DealHealth | "all")}
        >
          <option value="all">Any health</option>
          {(Object.keys(HEALTH_LABEL) as DealHealth[]).map((h) => (
            <option key={h} value={h}>
              {HEALTH_LABEL[h]}
            </option>
          ))}
        </select>
        <select
          className={s.select}
          aria-label="Filter by tier"
          value={tier}
          onChange={(e) => setTier(e.target.value as InfluencerTier | "all")}
        >
          <option value="all">Any tier</option>
          {(Object.keys(TIER_LABEL) as InfluencerTier[]).map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {summary.error && !deals.error && (
        <p className={s.hint} style={{ marginTop: 8 }}>
          Counts: {errText(summary.error)}
        </p>
      )}

      {deals.isLoading ? (
        <p className={s.hint} style={{ padding: "20px 0" }}>
          Loading collabs…
        </p>
      ) : deals.error ? (
        <p className={s.err} style={{ padding: "20px 0" }}>
          {errText(deals.error)}
        </p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title={!anyFilter ? "No collabs yet" : "Nothing matches"}
          style={{ marginTop: 18 }}
          cta={
            !anyFilter ? (
              <button type="button" className="pm-btn sm" onClick={onAdd} style={{ marginTop: 10 }}>
                Add your first collab
              </button>
            ) : undefined
          }
        >
          {!anyFilter
            ? "Add a creator you have agreed a barter collab with. The board then tracks the brief, the box, the draft and the post."
            : "No collabs match these filters."}
        </EmptyState>
      ) : view === "board" ? (
        <div className={s.board}>
          {GROUPS.map((g) => {
            const cards = sorted.filter((d) => STAGE_GROUP[d.stage] === g.key);
            return (
              <div key={g.key} className={s.col}>
                <div className={s.colHead}>
                  <span className={s.colTitle}>{g.label}</span>
                  <span className={s.colCount}>{cards.length}</span>
                </div>
                <div className={s.cards}>
                  {cards.length === 0 && <div className={s.emptyCol}>Nothing here</div>}
                  {cards.map((d) => (
                    <DealCard key={d.id} d={d} onOpen={() => onOpenDeal(d.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={s.tblCard}>
          <div className="pm-tablewrap">
            <table className={`pm-tbl ${s.tbl}`}>
              <thead>
                <tr>
                  {th("handle", "Creator")}
                  {th("tier", "Tier")}
                  {th("kit", "Kit")}
                  {th("stage", "Stage")}
                  {th("next", "Next date")}
                  {th("health", "Health")}
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => onOpenDeal(d.id)}>
                    <td className={s.mainCell}>
                      <b>{at(d.influencer.handle)}</b>
                      {d.influencer.full_name && <span>{d.influencer.full_name}</span>}
                    </td>
                    <td data-l="Tier">{d.influencer.tier ? TIER_LABEL[d.influencer.tier] : ""}</td>
                    <td data-l="Kit">{d.kit?.name ?? <span className={s.hint}>No kit</span>}</td>
                    <td data-l="Stage">{STAGE_LABEL[d.stage]}</td>
                    <td data-l="Next">
                      {d.next_date ? (
                        <span>
                          {d.next_date.label}{" "}
                          <span className={s.hint}>
                            {shortDate(d.next_date.at)} ({relDay(d.next_date.at)})
                          </span>
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td data-l="Health">
                      <HealthChip health={d.health} reason={d.health_reason} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function cap(v: string): string {
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

function DealCard({ d, onOpen }: { d: DealListItem; onOpen: () => void }) {
  const sub = [d.influencer.niche?.[0] ? cap(d.influencer.niche[0]) : null, compact(d.influencer.followers) || null, d.kit?.name ?? "No kit yet"]
    .filter(Boolean)
    .join(" · ");
  const late = d.health_reason && d.health !== "on_track" && d.health !== "closed";
  const what =
    STAGE_GROUP[d.stage] === "done"
      ? STAGE_LABEL[d.stage]
      : late
        ? d.health_reason
        : d.next_date
          ? `${d.next_date.label} ${relDay(d.next_date.at)}`
          : STAGE_LABEL[d.stage];
  return (
    <button type="button" className={s.card} onClick={onOpen}>
      <div className={s.cardTop}>
        <Initial handle={d.influencer.handle} />
        <span className={s.who}>
          <span className={s.handle}>{at(d.influencer.handle)}</span>
          <span className={s.whoSub}>{sub}</span>
        </span>
      </div>
      <div className={s.cardMeta} title={d.next_date ? shortDate(d.next_date.at) : undefined}>
        <span>{what}</span>
        <span className={s.spacer} />
        <HealthChip health={d.health} reason={d.health_reason} />
      </div>
    </button>
  );
}
