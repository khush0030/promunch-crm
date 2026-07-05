"use client";

// Lists tab: card grid of saved lead lists. Every "Find companies" run makes
// one automatically; empty lists can be created by hand and filled from a
// list's detail view.

import { useState } from "react";
import { Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { ListSummary } from "./types";
import { fmtTime } from "./format";

export default function ListsView({
  lists, loading, onOpen, onChanged, onFind,
}: {
  lists: ListSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onFind: () => void;
}) {
  const toast = useToast();
  const [creating, setCreating] = useState(false);

  async function createList() {
    const name = prompt("Name the new list:");
    if (!name?.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/leads/lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "create failed");
      onChanged();
    } catch (e) {
      toast.push({ kind: "error", text: `Could not create list: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="pm-empty">Loading…</div>;

  if (!lists.length) {
    return (
      <div className={styles.getStarted}>
        <div className={styles.getStartedTitle}>No lists yet</div>
        <p className={styles.getStartedText}>
          Search for companies (for example “gifting companies in Mumbai”) and the results are saved
          as a list here. Lists are what you send sequences to.
        </p>
        <div className={styles.getStartedActions}>
          <button type="button" className="pm-btn primary" onClick={onFind}>Find companies</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.listGrid}>
      {lists.map((l) => {
        const pct = l.leads ? Math.round((l.contacted / l.leads) * 100) : 0;
        return (
          <button type="button" key={l.id} className={styles.listCard} onClick={() => onOpen(l.id)}>
            <div className={styles.listCardTop}>
              <span className={styles.listCardName}>{l.name}</span>
              {l.active_sequence ? (
                <span className="pm-badge2 bg-green">● {l.active_sequence}</span>
              ) : l.contacted > 0 ? (
                <span className="pm-badge2 bg-gold">Contacted</span>
              ) : (
                <span className="pm-badge2 bg-gray">Not contacted</span>
              )}
            </div>
            <div className="pm-dim" style={{ fontSize: 12.5 }}>
              {l.leads} leads · {l.withEmail} with verified email{l.replied ? ` · ${l.replied} replied` : ""}
            </div>
            <div className={styles.listBar}><i style={{ width: `${pct}%` }} /></div>
            <div className={styles.listCardFoot}>
              <span>{l.contacted} of {l.leads} contacted</span>
              <span>{fmtTime(l.updated_at)}</span>
            </div>
          </button>
        );
      })}
      <button type="button" className={styles.newListCard} onClick={createList} disabled={creating}>
        <Plus size={15} /> New empty list
      </button>
    </div>
  );
}
