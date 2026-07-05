"use client";

// One list: its leads with last-contacted + sequence status, rename/remove,
// and the "Enroll in sequence" action that kicks off a bulk campaign.

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Pencil, Send, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { Lead, ListLead, ListSummary, SequenceRow } from "./types";
import { CONFIDENCE_PILL } from "./styles";
import { bestContact, fitPill, fmtTime } from "./format";

const ENROLL_PILL: Record<string, { cls: string; label: string }> = {
  active: { cls: "bg-blue", label: "In sequence" },
  sending: { cls: "bg-blue", label: "Sending…" },
  completed: { cls: "bg-gray", label: "Sequence done" },
  replied: { cls: "bg-gold", label: "Replied — stopped" },
  bounced: { cls: "bg-terra", label: "Bounced" },
  stopped: { cls: "bg-gray", label: "Stopped" },
};

export default function ListDetail({
  listId, onBack, onOpenLead,
}: {
  listId: string;
  onBack: () => void;
  onOpenLead: (lead: Lead) => void;
}) {
  const toast = useToast();
  const [list, setList] = useState<ListSummary | null>(null);
  const [leads, setLeads] = useState<ListLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/lists/${listId}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error || "load failed");
      const json = await res.json();
      setList(json.list);
      setLeads(json.leads);
    } catch (e) {
      toast.push({ kind: "error", text: `Could not load list: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setLoading(false);
    }
  }, [listId, toast]);

  useEffect(() => { load(); }, [load]);

  async function rename() {
    const name = prompt("Rename list:", list?.name ?? "");
    if (!name?.trim() || name.trim() === list?.name) return;
    const res = await fetch(`/api/leads/lists/${listId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) load();
    else toast.push({ kind: "error", text: (await res.json()).error || "rename failed" });
  }

  async function removeLead(leadId: string, name: string) {
    if (!confirm(`Remove ${name} from this list? The lead itself is kept.`)) return;
    const res = await fetch(`/api/leads/lists/${listId}/members`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_ids: [leadId] }),
    });
    if (res.ok) load();
    else toast.push({ kind: "error", text: (await res.json()).error || "remove failed" });
  }

  if (loading) return <div className="pm-empty">Loading…</div>;
  if (!list) return <div className="pm-empty">List not found.</div>;

  return (
    <div>
      <div className={styles.listDetailBar}>
        <button type="button" className="pm-btn ghost" onClick={onBack}>
          <ArrowLeft size={14} /> All lists
        </button>
        <div className={styles.listDetailTitle}>
          <b>{list.name}</b>
          <span className="pm-dim"> · {leads.length} leads</span>
        </div>
        <div className={styles.toolbar}>
          <button type="button" className="pm-btn" onClick={rename}><Pencil size={13} /> Rename</button>
          <button type="button" className="pm-btn primary" onClick={() => setShowEnroll(true)}>
            <Send size={13} /> Enroll in sequence
          </button>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="pm-empty">
          No leads in this list yet. If it came from a company search, hit “Keep going” on the
          header to let the pipeline finish discovering and verifying emails.
        </div>
      ) : (
        <div className={`pm-tablewrap ${styles.tableWrap}`}>
          <table className="pm-tbl">
            <thead>
              <tr>
                <th style={{ width: 56 }}>Fit</th>
                <th>Company</th>
                <th>Contact</th>
                <th>Last contacted</th>
                <th>Status</th>
                <th style={{ width: 40 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const fp = fitPill(lead.fit_score);
                const best = bestContact(lead);
                const en = lead.enrollment;
                const ep = en ? ENROLL_PILL[en.status] ?? { cls: "bg-gray", label: en.status } : null;
                return (
                  <tr key={lead.id} className="clickable" onClick={() => onOpenLead(lead)}>
                    <td><span className={`pm-badge2 ${fp.cls}`}>{fp.label}</span></td>
                    <td>
                      <div className="pm-cellname"><span className="pm-b7">{lead.name}</span></div>
                      <div className="pm-dim">{[lead.category, lead.city].filter(Boolean).join(" · ") || "—"}</div>
                    </td>
                    <td>
                      {best ? (
                        <span>
                          <span className="mono" style={{ fontSize: 12.5 }}>{best.email}</span>{" "}
                          <span className={`pm-badge2 ${CONFIDENCE_PILL[best.confidence] ?? "bg-gray"}`}>{best.confidence}</span>
                        </span>
                      ) : (
                        <span className="pm-muted">no verified email</span>
                      )}
                    </td>
                    <td>
                      {lead.last_contacted_at ? (
                        <span>
                          {fmtTime(lead.last_contacted_at)}
                          {en && en.status === "active" ? (
                            <span className="pm-dim" style={{ fontSize: 11.5 }}> (step {en.current_step + 1})</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="pm-muted">Never</span>
                      )}
                    </td>
                    <td>
                      {ep ? (
                        <span className={`pm-badge2 ${ep.cls}`} title={en?.sequence_name ?? undefined}>{ep.label}</span>
                      ) : best ? (
                        <span className="pm-badge2 bg-gray">Not enrolled</span>
                      ) : (
                        <span className="pm-badge2 bg-gray">Skipped</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="pm-btn ghost"
                        style={{ padding: "4px 7px" }}
                        aria-label={`Remove ${lead.name} from list`}
                        onClick={() => removeLead(lead.id, lead.name)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showEnroll && (
        <EnrollModal
          listId={listId}
          listName={list.name}
          onClose={() => setShowEnroll(false)}
          onDone={() => { setShowEnroll(false); load(); }}
        />
      )}
    </div>
  );
}

function EnrollModal({
  listId, listName, onClose, onDone,
}: {
  listId: string;
  listName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/leads/sequences", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setSequences((j.sequences ?? []).filter((s: SequenceRow) => s.status !== "archived")))
      .catch(() => setSequences([]));
  }, []);

  async function enroll() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/sequences/${selected}/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ list_id: listId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "enroll failed");
      const skippedNote = Object.entries(json.skipped as Record<string, number>)
        .map(([reason, n]) => `${n} ${reason}`)
        .join(", ");
      toast.push({
        kind: "success",
        text: `${json.enrolled} leads enrolled.${skippedNote ? ` Skipped: ${skippedNote}.` : ""}`,
      });
      onDone();
    } catch (e) {
      toast.push({ kind: "error", text: `Enroll: ${e instanceof Error ? e.message : "unknown"}` });
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`pm-card ${styles.modal} ${styles.modalSm}`} onClick={(e) => e.stopPropagation()} style={{ padding: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Enroll “{listName}”</h3>
        <p className="pm-muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
          Every lead with a verified email joins the sequence. Emails go out inside the send window,
          within the daily cap; anyone who replies is stopped automatically.
        </p>
        {sequences.length === 0 ? (
          <div className="pm-empty" style={{ padding: 18 }}>
            No sequences yet — build one in the Sequences tab first.
          </div>
        ) : (
          <div className={styles.enrollOptions}>
            {sequences.map((s) => (
              <label key={s.id} className={`${styles.enrollOption}${selected === s.id ? ` ${styles.enrollOptionOn}` : ""}`}>
                <input
                  type="radio"
                  name="sequence"
                  checked={selected === s.id}
                  onChange={() => setSelected(s.id)}
                />
                <span>
                  <b>{s.name}</b>
                  <span className="pm-dim" style={{ display: "block", fontSize: 12 }}>
                    {s.steps.length} step{s.steps.length === 1 ? "" : "s"}
                    {s.steps.length > 1
                      ? ` · waits ${s.steps.slice(1).map((st) => `${st.wait_days}d`).join(", ")}`
                      : " (one-shot campaign)"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
        <div className={styles.actionRow}>
          <button type="button" className="pm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="pm-btn primary" disabled={!selected || busy} onClick={enroll}>
            {busy ? "Enrolling…" : "Enroll list"}
          </button>
        </div>
      </div>
    </div>
  );
}
