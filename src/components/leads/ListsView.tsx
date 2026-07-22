"use client";

// Lists tab: collapsible category groups with one slim row per list. Quiet by
// design — progress bars and badges only appear once a list has activity, so
// 24 untouched lists read as a short calm index, not 24 shouting cards.
//
// Rows are selectable: tick several lists to merge them into one or delete them
// in bulk. Deleting a list keeps the companies (they stay in your other lists);
// a running campaign on a deleted list keeps sending.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Send, Merge, Trash2, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { ListSummary } from "./types";
import { ConfirmModal, TextPromptModal } from "./Dialogs";

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

type Dialog =
  | { kind: "new" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "delete" }
  | { kind: "merge" }
  | null;

export default function ListsView({
  lists, loading, onOpen, onEmail, onChanged, onFind,
}: {
  lists: ListSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
  onEmail: (id: string) => void;
  onChanged: () => void;
  onFind: () => void;
}) {
  const toast = useToast();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const selectedList = useMemo(
    () => [...selected].map((id) => byId.get(id)).filter(Boolean) as ListSummary[],
    [selected, byId],
  );
  const runningInSelection = selectedList.filter((l) => l.active_sequence).length;
  const the = (n: number) => `${n} list${n === 1 ? "" : "s"}`;

  function clearSel() { setSelected(new Set()); }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setGroup(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  }

  async function createList(name: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/leads/lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "create failed");
      setDialog(null);
      onChanged();
      toast.push({ kind: "success", text: `Created “${name}”.` });
    } catch (e) {
      toast.push({ kind: "error", text: `Could not create list: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setBusy(false);
    }
  }

  async function renameList(id: string, name: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/lists/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "rename failed");
      setDialog(null);
      onChanged();
      toast.push({ kind: "success", text: "List renamed." });
    } catch (e) {
      toast.push({ kind: "error", text: `Could not rename: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    const ids = [...selected];
    setBusy(true);
    try {
      const results = await Promise.all(
        ids.map((id) => fetch(`/api/leads/lists/${id}`, { method: "DELETE" })),
      );
      const failed = results.filter((r) => !r.ok).length;
      setDialog(null);
      clearSel();
      onChanged();
      if (failed) {
        toast.push({ kind: "error", text: `Deleted ${ids.length - failed} of ${ids.length}. ${failed} failed.` });
      } else {
        toast.push({ kind: "success", text: `Deleted ${the(ids.length)}. Companies kept.` });
      }
    } catch (e) {
      toast.push({ kind: "error", text: `Delete failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setBusy(false);
    }
  }

  async function mergeSelected(name: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/leads/lists/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_ids: [...selected], name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "merge failed");
      setDialog(null);
      clearSel();
      onChanged();
      toast.push({ kind: "success", text: `Merged into “${name}” — ${json.merged} companies.` });
    } catch (e) {
      toast.push({ kind: "error", text: `Merge failed: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setBusy(false);
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

  const n = selected.size;

  return (
    <div>
      <div className={styles.listsHowTo}>
        <b>How to send a bulk campaign:</b> open any list below, then hit{" "}
        <b>Email this list</b>. A short wizard lets you pick recipients, find missing verified
        emails, choose the product angle, write or AI-draft the copy, and preview the exact email
        per company before anything sends. Tick lists to <b>merge</b> or <b>delete</b> them.
      </div>

      <div className={styles.tplToolbar} style={{ marginBottom: 10 }}>
        <button type="button" className="pm-btn" onClick={() => setDialog({ kind: "new" })} disabled={busy}>
          <Plus size={13} /> New empty list
        </button>
      </div>

      {n > 0 && (
        <div className={styles.bulkBar}>
          <span>{the(n)} selected</span>
          <div style={{ flex: 1 }} />
          {n === 1 && selectedList[0] && (
            <button type="button" className="pm-btn primary sm" onClick={() => onEmail(selectedList[0].id)}>
              <Send size={13} /> Email this list
            </button>
          )}
          {n === 1 && (
            <button
              type="button"
              className="pm-btn sm"
              onClick={() => {
                const l = selectedList[0];
                if (l) setDialog({ kind: "rename", id: l.id, name: l.name });
              }}
            >
              Rename
            </button>
          )}
          {n >= 2 && (
            <button type="button" className="pm-btn sm" onClick={() => setDialog({ kind: "merge" })}>
              <Merge size={13} /> Merge into one
            </button>
          )}
          <button type="button" className="pm-btn danger soft sm" onClick={() => setDialog({ kind: "delete" })}>
            <Trash2 size={13} /> Delete
          </button>
          <button type="button" className="pm-btn ghost sm" onClick={clearSel}>
            <X size={13} /> Clear
          </button>
        </div>
      )}

      <div className={styles.groupStack}>
        {ordered.map(([group, items]) => {
          const isCollapsed = collapsed.has(group);
          const totalLeads = items.reduce((a, l) => a + l.leads, 0);
          const totalReplied = items.reduce((a, l) => a + l.replied, 0);
          const running = items.filter((l) => l.active_sequence).length;
          const ids = items.map((l) => l.id);
          const allSel = items.every((l) => selected.has(l.id));
          const someSel = !allSel && items.some((l) => selected.has(l.id));
          return (
            <section key={group} className={styles.group}>
              <div className={styles.groupHeadRow}>
                <input
                  type="checkbox"
                  className={styles.listCheck}
                  checked={allSel}
                  ref={(el) => { if (el) el.indeterminate = someSel; }}
                  onChange={(e) => setGroup(ids, e.target.checked)}
                  aria-label={`Select all in ${group}`}
                />
                <button type="button" className={styles.groupHead} onClick={() => toggle(group)} aria-expanded={!isCollapsed}>
                  {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  <span className={styles.groupName}>{group}</span>
                  <span className={styles.groupMeta}>
                    {items.length} list{items.length === 1 ? "" : "s"} · {totalLeads} leads
                    {running ? ` · ${running} sequence${running === 1 ? "" : "s"} running` : ""}
                    {totalReplied ? ` · ${totalReplied} replied` : ""}
                  </span>
                </button>
              </div>
              {!isCollapsed && (
                <div className={styles.groupRows}>
                  {items.map((l) => {
                    const sel = selected.has(l.id);
                    return (
                      <div key={l.id} className={styles.listSelRow} data-sel={sel ? "true" : "false"}>
                        <input
                          type="checkbox"
                          className={styles.listCheck}
                          checked={sel}
                          onChange={() => toggleOne(l.id)}
                          aria-label={`Select ${l.name}`}
                        />
                        <button type="button" className={styles.listRow} onClick={() => onOpen(l.id)}>
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
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {dialog?.kind === "new" && (
        <TextPromptModal
          title="New empty list"
          label="List name"
          placeholder="e.g. Corporate gifting — Mumbai"
          confirmLabel="Create list"
          onSubmit={createList}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "rename" && (
        <TextPromptModal
          title="Rename list"
          label="List name"
          defaultValue={dialog.name}
          confirmLabel="Save name"
          onSubmit={(name) => renameList(dialog.id, name)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "merge" && (
        <TextPromptModal
          title={`Merge ${the(n)} into one`}
          label="Name for the merged list"
          defaultValue={selectedList[0]?.name ?? ""}
          placeholder="e.g. Gifting — all cities"
          confirmLabel="Merge lists"
          onSubmit={mergeSelected}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "delete" && (
        <ConfirmModal
          title={`Delete ${the(n)}?`}
          danger
          busy={busy}
          confirmLabel={`Delete ${the(n)}`}
          onConfirm={deleteSelected}
          onClose={() => setDialog(null)}
          message={
            <>
              The companies in {n === 1 ? "this list" : "these lists"} are <b>kept</b> — they stay in your
              other lists and in the CRM. Only the {n === 1 ? "list" : "lists"} themselves are removed.
              {runningInSelection > 0 && (
                <>
                  {" "}
                  {runningInSelection === 1 ? "One selected list has" : `${runningInSelection} selected lists have`} a
                  campaign running; it keeps sending.
                </>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
