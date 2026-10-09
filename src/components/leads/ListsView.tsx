"use client";

// Step 2, Pick: one list per search (the only "list" idea). Filter by type and
// city; open one to tick businesses.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { Tag } from "@/components/pm";
import { STAGES, type Stage } from "@/lib/leads/lead-status";
import s from "./b2b.module.css";
import { api, nf, shortDate } from "./api";
import SearchProgressCard from "./SearchProgressCard";
import type { ListSummary, SearchProgress } from "./types";

const SHOWN: Stage[] = ["ready", "waiting", "queued", "sent", "replied", "no_email", "checking", "bounced"];
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

export function useLists() {
  return useQuery({
    queryKey: ["b2b", "lists"],
    queryFn: async () => (await api<{ lists: ListSummary[] }>("/api/leads/lists")).lists,
  });
}

export function listName(name: string): string {
  return name.replace(/\s+[—–]\s+/g, " · ");
}

export default function ListsView({
  searches, onOpen, onFind, onOpenList, showReady,
}: {
  searches: SearchProgress[];
  onOpen: (id: string) => void;
  onFind: () => void;
  onOpenList: (id: string) => void;
  showReady: boolean;
}) {
  const q = useLists();
  const [type, setType] = useState("");
  const [city, setCity] = useState("");
  const lists = useMemo(() => q.data ?? [], [q.data]);
  const types = useMemo(() => [...new Set(lists.map((l) => l.category).filter((x): x is string => !!x))].sort(), [lists]);
  const cities = useMemo(() => [...new Set(lists.map((l) => l.city).filter((x): x is string => !!x))].sort(), [lists]);
  const shown = lists
    .filter((l) => (!type || l.category === type) && (!city || l.city === city))
    .filter((l) => !showReady || (l.stages.ready ?? 0) > 0);
  const active = searches.filter((x) => x.active);

  return (
    <div className={s.body}>
      {active.length ? (
        <section className={`${s.card} ${s.cardFlush}`} aria-label="Finding now">
          {active.map((x) => <SearchProgressCard key={x.id} search={x} onOpenList={onOpenList} />)}
        </section>
      ) : null}

      {types.length > 1 || cities.length > 1 ? (
        <div className={s.toolbar}>
          {types.length > 1 ? (
            <select className={s.sel} style={{ width: "auto", minWidth: 200 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Business type">
              <option value="">Every business type</option>
              {types.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
          ) : null}
          {cities.length > 1 ? (
            <select className={s.sel} style={{ width: "auto", minWidth: 170 }} value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
              <option value="">Every city</option>
              {cities.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          ) : null}
          {showReady ? <Tag tone="blue" dot>Showing lists with Ready businesses</Tag> : null}
        </div>
      ) : null}

      <section className={`${s.card} ${s.cardFlush}`}>
        {q.isLoading ? (
          <p className={s.muted} style={{ padding: "22px 0" }}>Loading lists…</p>
        ) : q.error ? (
          <p className={s.errNote} style={{ padding: "22px 0" }}>Could not load lists: {(q.error as Error).message}</p>
        ) : shown.length === 0 ? (
          <div className={s.empty}>
            <b>{lists.length ? "No list matches" : "No lists yet"}</b>
            <p>Every search makes a list. Find businesses by type and city, then come back here to pick who to email.</p>
            <button type="button" className="pm-btn primary" onClick={onFind}><Search /> Find businesses</button>
          </div>
        ) : (
          shown.map((l) => (
            <button key={l.id} type="button" className={s.lrow} onClick={() => onOpen(l.id)}>
              <span className={s.lrowM}>
                <b>{listName(l.name)}</b>
                <span>
                  {nf(l.total)} businesses · made {shortDate(l.created_at)}
                </span>
                <span className={s.tags}>
                  {l.finding ? <Tag tone="blue" dot>Finding</Tag> : null}
                  {SHOWN.filter((st) => (l.stages[st] ?? 0) > 0).map((st) => (
                    <Tag key={st} tone={STAGES[st].tone}>{nf(l.stages[st])} {STAGES[st].label.toLowerCase()}</Tag>
                  ))}
                </span>
              </span>
              <span className={s.lrowGo} aria-hidden><ChevronRight /></span>
            </button>
          ))
        )}
      </section>
    </div>
  );
}
