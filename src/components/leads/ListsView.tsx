"use client";

// Lists tab: collapsible category groups with one slim row per list. Quiet by
// design — progress bars and badges only appear once a list has activity, so
// 24 untouched lists read as a short calm index, not 24 shouting cards.

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { ListSummary } from "./types";

function groupLabel(l: ListSummary): string {
  if (l.category) return l.category;
  // Custom / hand-made lists: try the auto-name shape "Category — City".
  const beforeDash = l.name.split(" — ")[0];
  return beforeDash !== l.name ? beforeDash : "Custom lists";
}

function rowLabel(l: ListSummary): string {
  if (l.city) return l.city;
  const afterDash = l.name.split(" — ")[1];
  return afterDash ?? l.name;
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
          as a list here. Open a list and hit “Email this list” to send it a campaign.
        </p>
        <div className={styles.getStartedActions}>
          <button type="button" className="pm-btn primary" onClick={onFind}>Find companies</button>
        </div>
      </div>
    );
  }

  // Group by category; groups with activity first, then by size.
  const groups = new Map<string, ListSummary[]>();
  for (const l of lists) {
    const g = groupLabel(l);
    groups.set(g, [...(groups.get(g) ?? []), l]);
  }
  const groupActivity = (items: ListSummary[]) =>
    items.reduce((a, l) => a + l.contacted + l.replied + (l.active_sequence ? 100 : 0), 0);
  const ordered = [...groups.entries()].sort(
    ([, a], [, b]) => groupActivity(b) - groupActivity(a) || b.length - a.length,
  );

  function toggle(g: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  return (
    <div>
      <div className={styles.listsHowTo}>
        <b>How to send a bulk campaign:</b> open any list below, then hit{" "}
        <b>Email this list</b>. A short wizard lets you pick recipients, find missing verified
        emails, choose the product angle, write or AI-draft the copy, and preview the exact email
        per company before anything sends.
      </div>

      <div className={styles.tplToolbar} style={{ marginBottom: 10 }}>
        <button type="button" className="pm-btn" onClick={createList} disabled={creating}>
          <Plus size={13} /> New empty list
        </button>
      </div>

      <div className={styles.groupStack}>
        {ordered.map(([group, items]) => {
          const isCollapsed = collapsed.has(group);
          const totalLeads = items.reduce((a, l) => a + l.leads, 0);
          const totalReplied = items.reduce((a, l) => a + l.replied, 0);
          const running = items.filter((l) => l.active_sequence).length;
          return (
            <section key={group} className={styles.group}>
              <button type="button" className={styles.groupHead} onClick={() => toggle(group)} aria-expanded={isCollapsed ? "false" : "true"}>
                {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <span className={styles.groupName}>{group}</span>
                <span className={styles.groupMeta}>
                  {items.length} list{items.length === 1 ? "" : "s"} · {totalLeads} leads
                  {running ? ` · ${running} sequence${running === 1 ? "" : "s"} running` : ""}
                  {totalReplied ? ` · ${totalReplied} replied` : ""}
                </span>
              </button>
              {!isCollapsed && (
                <div className={styles.groupRows}>
                  {items.map((l) => (
                    <button type="button" key={l.id} className={styles.listRow} onClick={() => onOpen(l.id)}>
                      <span className={styles.listRowName}>{rowLabel(l)}</span>
                      <span className={styles.listRowStat}>
                        {l.leads} leads · {l.withEmail} ✉
                      </span>
                      <span className={styles.listRowActivity}>
                        {l.active_sequence ? (
                          <span className="pm-badge2 bg-green">● {l.active_sequence}</span>
                        ) : l.replied > 0 ? (
                          <span className="pm-badge2 bg-gold">{l.replied} replied</span>
                        ) : l.contacted > 0 ? (
                          <span className="pm-dim">{l.contacted} of {l.leads} contacted</span>
                        ) : null}
                      </span>
                      <span className={styles.listRowDate}>{fmtDay(l.updated_at)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
