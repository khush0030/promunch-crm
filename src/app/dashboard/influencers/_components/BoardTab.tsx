"use client";

// Board tab: the "what needs doing" strip, then every collab as a kanban
// (one column per stage group) or a sortable table.

import { useMemo, useState } from "react";
import { LayoutGrid, List, Sparkles } from "lucide-react";
import { Callout, EmptyState, SearchBar } from "@/components/pm";
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
  TierTag,
  at,
  isToday,
  relDay,
  shortDate,
  useDeals,
  useSettings,
  useSummary,
} from "./ui";
import s from "../influencers.module.css";

type StripKey = keyof BoardSummary;

const STRIP: { key: StripKey; label: string; tone: string }[] = [
  { key: "due_today", label: "Due today", tone: s.tGold },
  { key: "overdue", label: "Overdue", tone: s.tTerra },
  { key: "at_risk", label: "At risk", tone: s.tGold },
  { key: "waiting_on_us", label: "Waiting on us", tone: s.tBlue },
  { key: "briefs_to_approve", label: "Briefs to approve", tone: "" },
  { key: "drafts_to_review", label: "Drafts to review", tone: "" },
  { key: "kits_to_ship", label: "Kits to ship", tone: "" },
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

  return (
    <>
      {engineOff && (
        <div style={{ marginBottom: 12 }}>
          <Callout
            tone="sun"
            title="Automatic reminders are off."
            body="Nothing is sent to creators until you switch them on in Settings."
          />
        </div>
      )}

      <div className={s.strip}>
        {STRIP.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${s.stat} ${t.tone} ${strip === t.key ? s.statOn : ""}`}
            aria-pressed={strip === t.key}
            title={strip === t.key ? "Click again to show everything" : `Show only: ${t.label}`}
            onClick={() => setStrip(strip === t.key ? null : t.key)}
          >
            <div className={s.statLabel}>{t.label}</div>
            <div className={s.statValue}>{sum ? sum[t.key] : summary.isLoading ? "…" : "–"}</div>
          </button>
        ))}
      </div>

      <div className={s.filters}>
        <div className={s.seg}>
          <button
            type="button"
            className={`${s.segBtn} ${view === "board" ? s.segOn : ""}`}
            onClick={() => setView("board")}
          >
            <LayoutGrid size={12} /> Board
          </button>
          <button
            type="button"
            className={`${s.segBtn} ${view === "list" ? s.segOn : ""}`}
            onClick={() => setView("list")}
          >
            <List size={12} /> List
          </button>
        </div>
        {strip && (
          <button type="button" className="pm-btn ghost sm" onClick={() => setStrip(null)}>
            Showing: {STRIP.find((x) => x.key === strip)?.label} ✕
          </button>
        )}
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
        <p className={s.hint} style={{ padding: 20 }}>
          Loading collabs…
        </p>
      ) : deals.error ? (
        <p className={s.err} style={{ padding: 20 }}>
          {errText(deals.error)}
        </p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title={!anyFilter ? "No collabs yet" : "Nothing matches"}
          style={{ marginTop: 14 }}
          cta={
            !anyFilter ? (
              <button type="button" className="pm-btn primary sm" onClick={onAdd} style={{ marginTop: 10 }}>
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
                  <span className={s.colDot} style={{ background: g.dot }} />
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
        <div className="pm-tablewrap" style={{ marginTop: 14 }}>
          <table className="pm-tbl">
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
                  <td>
                    <strong>{at(d.influencer.handle)}</strong>
                    {d.influencer.full_name && <div className={s.hint}>{d.influencer.full_name}</div>}
                  </td>
                  <td>{d.influencer.tier ? TIER_LABEL[d.influencer.tier] : ""}</td>
                  <td>{d.kit?.name ?? <span className={s.hint}>No kit</span>}</td>
                  <td>{STAGE_LABEL[d.stage]}</td>
                  <td>
                    {d.next_date ? (
                      <>
                        {d.next_date.label}
                        <div className={s.hint}>
                          {shortDate(d.next_date.at)} ({relDay(d.next_date.at)})
                        </div>
                      </>
                    ) : (
                      ""
                    )}
                  </td>
                  <td>
                    <HealthChip health={d.health} reason={d.health_reason} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function DealCard({ d, onOpen }: { d: DealListItem; onOpen: () => void }) {
  return (
    <button type="button" className={s.card} onClick={onOpen}>
      <div className={s.cardTop}>
        <Initial handle={d.influencer.handle} />
        <span className={s.handle}>{at(d.influencer.handle)}</span>
        <span style={{ marginLeft: "auto" }}>
          <TierTag tier={d.influencer.tier} />
        </span>
      </div>
      <div className={s.cardMeta}>
        {d.kit?.name ?? "No kit yet"}
        {STAGE_GROUP[d.stage] === "done" ? ` · ${STAGE_LABEL[d.stage]}` : ""}
      </div>
      {d.next_date && (
        <div className={s.cardMeta} title={shortDate(d.next_date.at)}>
          {d.next_date.label} <strong>{relDay(d.next_date.at)}</strong>
        </div>
      )}
      <div className={s.cardFoot}>
        <HealthChip health={d.health} reason={d.health_reason} />
        {d.health_reason && d.health !== "on_track" && d.health !== "closed" && (
          <span className={s.when}>{d.health_reason}</span>
        )}
      </div>
    </button>
  );
}
