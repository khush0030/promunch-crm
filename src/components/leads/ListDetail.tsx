"use client";

// B2B · List detail (prototype b2b-list): every business in one list and the
// stage it is at, with stage filter tiles and a bulk bar. Calls are unchanged:
//   GET    /api/leads/lists/[id]
//   PATCH  /api/leads/lists/[id]            { name }           (rename)
//   POST   /api/leads/[leadId]/enrich                          (find email)
//   DELETE /api/leads/lists/[id]/members    { lead_ids }       (remove)
// "Email selected" opens the same campaign wizard as before.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, MailSearch, Pencil, Send, Trash2, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import type { Lead, ListLead, ListSummary } from "./types";
import { listLabel, verifiedContact, bestContact } from "./format";
import { initials, leadStage, nf, shortDate, STAGE_TAG, type LeadStage } from "./stages";
import CampaignWizard from "./CampaignWizard";
import { ConfirmModal, TextPromptModal } from "./Dialogs";

type Filter = "all" | "no_email" | "review" | "sent" | "followup" | "replied";

const FILTERS: { key: Filter; label: string; tone?: "warn" | "info" | "good"; stages: LeadStage[] | null }[] = [
  { key: "all", label: "All", stages: null },
  { key: "no_email", label: "No email", stages: ["no_email", "checking", "saved"] },
  { key: "review", label: "To review", tone: "warn", stages: ["review", "writing"] },
  { key: "sent", label: "Sent", stages: ["sent", "bounced"] },
  { key: "followup", label: "In follow-ups", tone: "info", stages: ["followup"] },
  { key: "replied", label: "Replied", tone: "good", stages: ["replied"] },
];

export default function ListDetail({
  listId, onOpenLead, onReview, onListChanged,
}: {
  listId: string;
  onOpenLead: (lead: Lead) => void;
  onReview: () => void;
  onListChanged: () => void;
}) {
  const toast = useToast();
  const [list, setList] = useState<ListSummary | null>(null);
  const [leads, setLeads] = useState<ListLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [wizardSeed, setWizardSeed] = useState<string[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [revealing, setRevealing] = useState<string | null>(null); // lead id or "bulk"
  const [revealProgress, setRevealProgress] = useState("");
  const [dialog, setDialog] = useState<null | { kind: "rename" } | { kind: "remove"; ids: string[]; label: string }>(null);

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

  const staged = useMemo(() => leads.map((l) => ({ lead: l, stage: leadStage(l) })), [leads]);
  const countFor = (f: (typeof FILTERS)[number]) => (f.stages ? staged.filter((x) => f.stages!.includes(x.stage)).length : staged.length);
  const active = FILTERS.find((f) => f.key === filter)!;
  const shown = active.stages ? staged.filter((x) => active.stages!.includes(x.stage)) : staged;

  async function rename(name: string) {
    setDialog(null);
    const current = list?.name ? listLabel(list.name) : "";
    if (!name.trim() || name.trim() === list?.name || name.trim() === current) return;
    const res = await fetch(`/api/leads/lists/${listId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) { load(); onListChanged(); }
    else toast.push({ kind: "error", text: (await res.json()).error || "rename failed" });
  }

  // "Find email" = the existing enrich pass: re-crawl the site, extract
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
    else if (outcome === "none") toast.push({ kind: "error", text: `${lead.name}: checked the site but no work email turned up.` });
    else toast.push({ kind: "error", text: `${lead.name}: could not open the site (no website or it is down).` });
    load();
  }

  async function revealSelected() {
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
      text: `Emails found for ${found} of ${targets.length}${none ? `, ${none} had none on their site` : ""}${failed ? `, ${failed} could not be opened` : ""}.`,
    });
    load();
  }

  async function removeLeads(ids: string[]) {
    setDialog(null);
    const res = await fetch(`/api/leads/lists/${listId}/members`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_ids: ids }),
    });
    if (res.ok) {
      setChecked(new Set());
      load();
      onListChanged();
    } else {
      toast.push({ kind: "error", text: (await res.json()).error || "remove failed" });
    }
  }

  if (loading) return <div className={s.body}><div className={s.card}><p className={s.muted}>Loading…</p></div></div>;
  if (!list) return <div className={s.body}><div className={s.card}><p className={s.muted}>List not found.</p></div></div>;

  const unverifiedChecked = leads.filter((l) => checked.has(l.id) && !verifiedContact(l));
  const shownIds = shown.map((x) => x.lead.id);
  const allShownChecked = shownIds.length > 0 && shownIds.every((id) => checked.has(id));
  const reviewCount = staged.filter((x) => x.stage === "review").length;

  return (
    <div className={s.body}>
      <div className={s.lstages} role="tablist" aria-label="Filter by stage">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={s.ls} data-on={filter === f.key} data-tone={f.tone} onClick={() => setFilter(f.key)}>
            <b>{nf(countFor(f))}</b>
            <span>{f.label}</span>
          </button>
        ))}
      </div>

      <div className={s.row} style={{ justifyContent: "space-between" }}>
        <label className={s.row} style={{ gap: 10, fontSize: 15, color: "var(--pm-ink2)", cursor: "pointer" }}>
          <input
            type="checkbox"
            className={s.check}
            checked={allShownChecked}
            onChange={(e) => setChecked(e.target.checked ? new Set([...checked, ...shownIds]) : new Set([...checked].filter((id) => !shownIds.includes(id))))}
          />
          Select all {active.key === "all" ? "" : active.label.toLowerCase()} ({nf(shown.length)})
        </label>
        <div className={s.row}>
          {reviewCount > 0 ? (
            <button type="button" className={s.txtLink} onClick={onReview}>Review {nf(reviewCount)} emails <ArrowRight /></button>
          ) : null}
          <button type="button" className={s.txtLink} style={{ color: "var(--pm-ink2)" }} onClick={() => setDialog({ kind: "rename" })}>
            <Pencil /> Rename
          </button>
        </div>
      </div>

      <section className={`${s.card} ${s.cardFlush}`}>
        {shown.length === 0 ? (
          <div className={s.empty}>
            <b>{leads.length === 0 ? "No businesses in this list yet" : `Nothing at “${active.label}”`}</b>
            <p>
              {leads.length === 0
                ? "If it came from a search, run the next batch from Find and the businesses appear here as they are found."
                : "Pick another stage above."}
            </p>
          </div>
        ) : (
          <div className={s.bizList}>
            {shown.map(({ lead, stage }) => {
              const verified = verifiedContact(lead);
              const best = bestContact(lead);
              const tag = STAGE_TAG[stage];
              const en = lead.enrollment;
              const when = lead.last_contacted_at
                ? `${en?.status === "active" ? `step ${en.current_step + 1} · ` : ""}${shortDate(lead.last_contacted_at)}`
                : lead.fit_score != null
                  ? `fit ${lead.fit_score}/100`
                  : "";
              return (
                <div key={lead.id} className={s.bz}>
                  <input
                    type="checkbox"
                    className={s.check}
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
                  <span className={s.cj} data-tone={tag.tone === "good" ? "good" : tag.tone === "info" ? "info" : tag.tone === "warn" ? "warn" : undefined}>{initials(lead.name)}</span>
                  <button type="button" className={s.clM} style={{ appearance: "none", border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => onOpenLead(lead)}>
                    <b>{lead.name}</b>
                    <span>
                      {verified ? verified.email : best ? `${best.email} · not verified` : "No work email found"}
                    </span>
                  </button>
                  <span className={s.clO}>
                    {stage === "no_email" || stage === "saved" ? (
                      <button type="button" className={s.txtLink} disabled={revealing !== null} onClick={() => revealEmail(lead)}>
                        <MailSearch /> {revealing === lead.id ? "Looking…" : "Find email"}
                      </button>
                    ) : stage === "review" ? (
                      <button type="button" className={s.txtLink} onClick={onReview}>To review <ArrowRight /></button>
                    ) : (
                      <span className={s.tg} data-tone={tag.tone}>{tag.label}</span>
                    )}
                    {when ? <time>{when}</time> : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className={s.muted} style={{ margin: 0, fontSize: 14 }}>
        Tick businesses to email them as a follow-up campaign, find their emails, or remove them from this list (the business itself is kept).
      </p>

      {checked.size > 0 && (
        <div className={s.actbar}>
          <div className={s.abM}>
            <b>{nf(checked.size)} picked</b>
            <span>{unverifiedChecked.length ? `${nf(unverifiedChecked.length)} without a checked email` : "All have a checked email"}</span>
          </div>
          <button type="button" className="pm-btn" disabled={revealing !== null || unverifiedChecked.length === 0} onClick={revealSelected}>
            <MailSearch /> {revealing === "bulk" ? `Finding ${revealProgress}…` : "Find emails"}
          </button>
          <button type="button" className="pm-btn" disabled={revealing !== null} onClick={() => setDialog({ kind: "remove", ids: [...checked], label: `${checked.size} business${checked.size === 1 ? "" : "es"}` })}>
            <Trash2 /> Remove
          </button>
          <button type="button" className="pm-btn" aria-label="Clear selection" onClick={() => setChecked(new Set())} disabled={revealing !== null}>
            <X />
          </button>
          <button type="button" className="pm-btn primary" disabled={revealing !== null} onClick={() => setWizardSeed([...checked])}>
            <Send /> Email {nf(checked.size)}
          </button>
        </div>
      )}

      {dialog?.kind === "rename" && (
        <TextPromptModal
          title="Rename list"
          label="List name"
          defaultValue={listLabel(list.name)}
          onSubmit={rename}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "remove" && (
        <ConfirmModal
          title="Remove from this list?"
          message={<>Remove {dialog.label} from this list? The businesses themselves are kept.</>}
          confirmLabel="Remove"
          danger
          onConfirm={() => removeLeads(dialog.ids)}
          onClose={() => setDialog(null)}
        />
      )}

      {wizardSeed && (
        <CampaignWizard
          listId={listId}
          initialLeadIds={wizardSeed}
          onClose={() => { setWizardSeed(null); load(); }}
          onDone={() => { load(); onListChanged(); }}
        />
      )}
    </div>
  );
}
