"use client";

// One list: its leads with last-contacted + sequence status, rename/remove,
// and the "Email this list" action that opens the campaign wizard.

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, MailSearch, Pencil, Send, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { Lead, ListLead, ListSummary } from "./types";
import { CONFIDENCE_PILL } from "./styles";
import { bestContact, fitPill, fmtTime, verifiedContact } from "./format";
import CampaignWizard from "./CampaignWizard";

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
  const [showWizard, setShowWizard] = useState(false);
  // Selection handed to the wizard: undefined = whole list (header button),
  // an id array = "Email selected" from the bulk bar.
  const [wizardSeed, setWizardSeed] = useState<string[] | undefined>(undefined);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [revealing, setRevealing] = useState<string | null>(null); // lead id or "bulk"
  const [revealProgress, setRevealProgress] = useState("");

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

  // "Reveal email" = the existing enrich pass: re-crawl the site, extract
  // addresses, MX-verify, promote the lead if one checks out.
  async function revealOne(lead: ListLead): Promise<"found" | "none" | "failed"> {
    try {
      const res = await fetch(`/api/leads/${lead.id}/enrich`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "enrich failed");
      return (json.newUsable ?? 0) > 0 || (json.contactsFound ?? 0) > 0 ? "found" : "none";
    } catch {
      return "failed";
    }
  }

  async function revealEmail(lead: ListLead) {
    setRevealing(lead.id);
    const outcome = await revealOne(lead);
    setRevealing(null);
    if (outcome === "found") toast.push({ kind: "success", text: `Found an email for ${lead.name}.` });
    else if (outcome === "none") toast.push({ kind: "error", text: `${lead.name}: crawled the site but no verified email turned up.` });
    else toast.push({ kind: "error", text: `${lead.name}: could not crawl (no website or site unreachable).` });
    load();
  }

  async function revealSelected() {
    // Only crawl leads that still lack a sendable (verified) email.
    const targets = leads.filter((l) => checked.has(l.id) && !verifiedContact(l));
    if (!targets.length) return;
    setRevealing("bulk");
    let found = 0, none = 0, failed = 0;
    for (let i = 0; i < targets.length; i++) {
      setRevealProgress(`${i + 1}/${targets.length}`);
      const outcome = await revealOne(targets[i]);
      if (outcome === "found") found++;
      else if (outcome === "none") none++;
      else failed++;
    }
    setRevealing(null);
    setRevealProgress("");
    toast.push({
      kind: found ? "success" : "error",
      text: `Emails found for ${found} of ${targets.length} leads${none ? `, ${none} had none on their site` : ""}${failed ? `, ${failed} could not be crawled` : ""}.`,
    });
    load();
  }

  async function removeSelected() {
    const ids = [...checked];
    if (!ids.length) return;
    if (!confirm(`Remove ${ids.length} lead${ids.length === 1 ? "" : "s"} from this list? The leads themselves are kept.`)) return;
    const res = await fetch(`/api/leads/lists/${listId}/members`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_ids: ids }),
    });
    if (res.ok) {
      setChecked(new Set());
      load();
    } else {
      toast.push({ kind: "error", text: (await res.json()).error || "remove failed" });
    }
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
          <button type="button" className="pm-btn primary" onClick={() => { setWizardSeed(undefined); setShowWizard(true); }}>
            <Send size={13} /> Email this list
          </button>
        </div>
      </div>

      <p className={styles.listDetailHint}>
        <b>Email this list</b> walks you through the whole campaign: pick who gets it, write or
        AI-draft the copy (with product targeting), preview the exact email per company, then
        launch. Or tick any leads below to email just those, find their verified emails, or remove
        them from the list.
      </p>

      {leads.length === 0 ? (
        <div className="pm-empty">
          No leads in this list yet. If it came from a company search, hit “Keep going” on the
          header to let the pipeline finish discovering and verifying emails.
        </div>
      ) : (
        <>
        {(() => {
          const unverifiedChecked = leads.filter((l) => checked.has(l.id) && !verifiedContact(l));
          const allChecked = leads.length > 0 && leads.every((l) => checked.has(l.id));
          return (
            <>
            {checked.size > 0 && (
              <div className={styles.bulkBar}>
                <span>{checked.size} lead{checked.size === 1 ? "" : "s"} selected</span>
                <button
                  type="button"
                  className="pm-btn primary"
                  disabled={revealing !== null}
                  onClick={() => { setWizardSeed([...checked]); setShowWizard(true); }}
                >
                  <Send size={13} /> Email selected ({checked.size})
                </button>
                <button
                  type="button"
                  className="pm-btn"
                  disabled={revealing !== null || unverifiedChecked.length === 0}
                  title={unverifiedChecked.length === 0 ? "Everyone selected already has a verified email" : undefined}
                  onClick={revealSelected}
                >
                  <MailSearch size={13} />{" "}
                  {revealing === "bulk" ? `Finding emails ${revealProgress}…` : `Find emails (${unverifiedChecked.length})`}
                </button>
                <button type="button" className="pm-btn ghost" disabled={revealing !== null} onClick={removeSelected}>
                  <Trash2 size={13} /> Remove
                </button>
                <button type="button" className="pm-btn ghost" onClick={() => setChecked(new Set())} disabled={revealing !== null}>
                  Clear
                </button>
              </div>
            )}
        <div className={`pm-tablewrap ${styles.tableWrap}`}>
          <table className="pm-tbl">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all leads"
                    checked={allChecked}
                    onChange={(e) =>
                      setChecked(e.target.checked ? new Set(leads.map((l) => l.id)) : new Set())
                    }
                  />
                </th>
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
                const verified = verifiedContact(lead);
                const en = lead.enrollment;
                const ep = en ? ENROLL_PILL[en.status] ?? { cls: "bg-gray", label: en.status } : null;
                return (
                  <tr key={lead.id} className="clickable" onClick={() => onOpenLead(lead)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${lead.name}`}
                        checked={checked.has(lead.id)}
                        onChange={(e) =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(lead.id);
                            else next.delete(lead.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td><span className={`pm-badge2 ${fp.cls}`}>{fp.label}</span></td>
                    <td>
                      <div className="pm-cellname"><span className="pm-b7">{lead.name}</span></div>
                      <div className="pm-dim">{[lead.category, lead.city].filter(Boolean).join(" · ") || "—"}</div>
                    </td>
                    <td>
                      {verified ? (
                        <span>
                          <span className="mono" style={{ fontSize: 12.5 }}>{verified.email}</span>{" "}
                          <span className={`pm-badge2 ${CONFIDENCE_PILL[verified.confidence] ?? "bg-gray"}`}>{verified.confidence}</span>
                        </span>
                      ) : (
                        <span className={styles.noEmailCell} onClick={(e) => e.stopPropagation()}>
                          {best ? (
                            <>
                              <span className="mono pm-dim" style={{ fontSize: 12.5 }}>{best.email}</span>
                              <span className="pm-badge2 bg-gold" title="Address found but its mail server did not verify — campaigns skip it">unverified</span>
                            </>
                          ) : (
                            <span className="pm-muted">no verified email</span>
                          )}
                          <button
                            type="button"
                            className="pm-btn"
                            style={{ padding: "3px 9px", fontSize: 11.5 }}
                            disabled={revealing !== null}
                            onClick={() => revealEmail(lead)}
                          >
                            <MailSearch size={12} /> {revealing === lead.id ? "Finding…" : "Find email"}
                          </button>
                        </span>
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
                      ) : verified ? (
                        <span className="pm-badge2 bg-gray">Not enrolled</span>
                      ) : (
                        <span className="pm-badge2 bg-gray">No email yet</span>
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
            </>
          );
        })()}
        </>
      )}

      {showWizard && (
        <CampaignWizard
          listId={listId}
          initialLeadIds={wizardSeed}
          onClose={() => { setShowWizard(false); load(); }}
          onDone={load}
        />
      )}
    </div>
  );
}
