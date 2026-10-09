"use client";

// One deal, top to bottom, in the order you need it:
//   1. Who and where: company, stage, value, owner, stage buttons
//   2. Next step: what to do, by when (follow-up date), Done
//   3. Contact: name, email, phone, type (all editable in place)
//   4. How keen they seem (read from their emails), where it stands
//   5. Activity log: notes, calls, WhatsApp, meetings (append-only)
//   6. Emails (collapsed), then Merge / Delete
// Right-hand sheet on desktop, full-screen on phones. Opened by
// /dashboard/deals?deal=<id>. Nothing here sends a message: email and phone
// are plain mailto: / tel: links the person taps themselves.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Mail, Phone, Trash2, X } from "lucide-react";
import { ConfirmDialog, Tag } from "@/components/pm";
import {
  ACTIVITY_LABEL,
  ALL_KINDS,
  KIND_LABEL,
  LOGGABLE_KINDS,
  SOURCE_LABEL,
  SOURCE_TONE,
  formatPhone,
  formatRupees,
  istToday,
  type ActivityKind,
  type Deal,
  type DealActivity,
  type DealDetailResponse,
  type DealKind,
  type TeamPerson,
} from "@/lib/deals/model";
import { STAGE_LABEL, STAGE_TONE, isClosedStage } from "@/lib/deals/stages";
import { KEEN_LABEL, KEEN_TONE } from "./constants";
import { FollowUpTag, nextStepText, personName } from "./DealBits";
import { NextStageButton, StageSelect, useStageMover } from "./StageControls";
import { usePatchDeal, DEALS_KEY, type DealPatchBody } from "./useDeals";
import { daysSince, dateTime, shortDate, timeAgo } from "./format";
import css from "./deals.module.css";

export function DealDrawer({
  dealId,
  allDeals,
  people,
  onClose,
  onGone,
}: {
  dealId: string;
  allDeals: Deal[];
  people: TeamPerson[];
  onClose: () => void;
  /** The deal was deleted or merged away (optionally: open this one instead). */
  onGone: (openId?: string) => void;
}) {
  const titleId = useId();
  const { data, isLoading, error } = useQuery({
    queryKey: ["deal", dealId],
    queryFn: async (): Promise<DealDetailResponse> => {
      const res = await fetch(`/api/deals/${dealId}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load this deal");
      return d;
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // The board cache is updated optimistically, so prefer it for the fields.
  const listDeal = allDeals.find((d) => d.id === dealId) ?? null;
  const deal = listDeal ?? data?.deal ?? null;

  return (
    <div className={css.scrim} onClick={onClose}>
      <aside className={css.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={css.sheetX} onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        {!deal && isLoading && <p className={css.muted}>Loading…</p>}
        {!deal && error instanceof Error && <p className={css.err}>{error.message}</p>}
        {deal && (
          <DrawerBody
            titleId={titleId}
            deal={deal}
            detail={data ?? null}
            allDeals={allDeals}
            people={people}
            onGone={onGone}
          />
        )}
      </aside>
    </div>
  );
}

function DrawerBody({
  titleId,
  deal,
  detail,
  allDeals,
  people,
  onGone,
}: {
  titleId: string;
  deal: Deal;
  detail: DealDetailResponse | null;
  allDeals: Deal[];
  people: TeamPerson[];
  onGone: (openId?: string) => void;
}) {
  const qc = useQueryClient();
  const patch = usePatchDeal();
  const today = istToday();
  const save = (body: DealPatchBody) => patch.mutate({ id: deal.id, body });
  const { move, dialog } = useStageMover((_d, stage, reason) => save({ stage, ...(reason ? { reason } : {}) }), patch.isPending);
  const closed = isClosedStage(deal.stage);
  const inStage = daysSince(deal.stage_updated_at);
  const ins = deal.insights;
  const emails = detail?.emails ?? [];

  return (
    <>
      {/* 1 · who and where */}
      <header className={css.dHead}>
        <InlineText
          id={titleId}
          className={css.dTitle}
          value={deal.company_name}
          placeholder="Business name"
          ariaLabel="Business name"
          onSave={(v) => v && save({ company_name: v })}
        />
        <div className={css.dMeta}>
          <Tag tone={STAGE_TONE[deal.stage]} dot>
            {STAGE_LABEL[deal.stage]}
          </Tag>
          <Tag tone={SOURCE_TONE[deal.source]} size="sm">
            {SOURCE_LABEL[deal.source]}
            {deal.source_ref && deal.source === "bulk_form" ? ` ${deal.source_ref}` : ""}
          </Tag>
          <FollowUpTag deal={deal} today={today} size="md" />
          {inStage !== null && <span className={css.muted}>{inStage <= 0 ? "In this stage since today" : `In this stage ${inStage} days`}</span>}
        </div>
        <div className={css.dFacts}>
          <label className={css.fact}>
            <span>Value</span>
            <InlineText
              className={css.factInput}
              value={deal.value_inr != null ? formatRupees(deal.value_inr, false) : ""}
              placeholder="Add ₹ value"
              ariaLabel="Value in rupees"
              inputMode="decimal"
              onSave={(v) => save({ value_inr: v })}
            />
          </label>
          <label className={css.fact}>
            <span>Owner</span>
            <select className={css.factSelect} value={deal.owner_email ?? ""} onChange={(e) => save({ owner_email: e.target.value || null })}>
              <option value="">No owner</option>
              {deal.owner_email && !people.some((p) => p.email === deal.owner_email) && (
                <option value={deal.owner_email}>{personName(deal.owner_email, people)}</option>
              )}
              {people.map((p) => (
                <option key={p.email} value={p.email}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={css.fact}>
            <span>Stage</span>
            <StageSelect deal={deal} onPick={(s) => move(deal, s)} disabled={patch.isPending} />
          </label>
        </div>
        {closed ? (
          <div className={css.closedNote}>
            <span>
              {deal.stage === "lost" ? "Lost" : "On hold"}
              {deal.closed_reason ? `: ${deal.closed_reason}` : ""}
            </span>
            <button type="button" className="pm2-btn sm" onClick={() => save({ stage: "talking" })} disabled={patch.isPending}>
              Reopen
            </button>
          </div>
        ) : (
          <div className={css.dStageRow}>
            <NextStageButton deal={deal} onPick={(s) => move(deal, s)} disabled={patch.isPending} size="md" />
          </div>
        )}
        {patch.error instanceof Error && <p className={css.err}>{patch.error.message}</p>}
      </header>

      {/* 2 · next step */}
      {!closed && <NextStepBlock deal={deal} emails={emails} today={today} busy={patch.isPending} onSave={save} />}

      {/* 3 · contact */}
      <Section title="Contact">
        <div className={css.fields}>
          <Field label="Name">
            <InlineText className={css.fieldInput} value={deal.contact_name ?? ""} placeholder="Add name" ariaLabel="Contact name" onSave={(v) => save({ contact_name: v })} />
          </Field>
          <Field label="Email">
            <InlineText className={css.fieldInput} value={deal.contact_email ?? ""} placeholder="Add email" ariaLabel="Contact email" inputMode="email" onSave={(v) => save({ contact_email: v })} />
          </Field>
          <Field label="Phone">
            <InlineText
              className={css.fieldInput}
              value={deal.contact_phone ? formatPhone(deal.contact_phone) : ""}
              placeholder="Add phone"
              ariaLabel="Contact phone"
              inputMode="tel"
              onSave={(v) => save({ contact_phone: v })}
            />
          </Field>
          <Field label="Type">
            <select className={css.fieldInput} value={deal.kind} onChange={(e) => save({ kind: e.target.value as DealKind })}>
              {ALL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className={css.contactLinks}>
          {deal.contact_email && closed && (
            <a className="pm2-btn sm" href={`mailto:${deal.contact_email}`}>
              <Mail size={15} aria-hidden /> Write an email
            </a>
          )}
          {deal.contact_phone && (
            <a className="pm2-btn sm" href={`tel:+${deal.contact_phone}`}>
              <Phone size={15} aria-hidden /> Call
            </a>
          )}
        </div>
      </Section>

      {/* 4 · how keen + where it stands */}
      {(ins || deal.summary || deal.commercials) && (
        <Section title="What we know">
          {ins && deal.interest_temp && (
            <div className={css.keen}>
              <span className={css.keenLabel}>How keen they seem</span>
              <Tag tone={KEEN_TONE[deal.interest_temp]} dot>
                {KEEN_LABEL[deal.interest_temp]}
              </Tag>
            </div>
          )}
          {ins?.sentiment && <p className={css.prose}>{ins.sentiment}</p>}
          {deal.summary && (
            <>
              <h4 className={css.subhead}>Where it stands</h4>
              <p className={css.prose}>{deal.summary}</p>
            </>
          )}
          {deal.commercials && (
            <>
              <h4 className={css.subhead}>Terms discussed</h4>
              <p className={css.prose}>{deal.commercials}</p>
            </>
          )}
          {ins && ins.drivers.length > 0 && (
            <>
              <h4 className={css.subhead}>What they care about</h4>
              <ul className={css.bullets}>{ins.drivers.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
          {ins && ins.risks.length > 0 && (
            <>
              <h4 className={css.subhead}>What could stop it</h4>
              <ul className={css.bullets}>{ins.risks.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
          {deal.samples_sent_at && <p className={css.muted}>Samples sent {shortDate(deal.samples_sent_at)} ({timeAgo(deal.samples_sent_at)})</p>}
        </Section>
      )}

      {/* 5 · activity */}
      <Section title="Activity">
        <ActivityComposer dealId={deal.id} />
        <ActivityTimeline activity={detail?.activity ?? []} notes={detail && !detail.schema_ready ? deal.notes : null} people={people} loading={!detail} />
      </Section>

      {/* 6 · emails, merge, delete */}
      <EmailList emails={emails} />
      <DangerZone
        deal={deal}
        allDeals={allDeals}
        onDone={(openId) => {
          qc.invalidateQueries({ queryKey: DEALS_KEY });
          onGone(openId);
        }}
      />
      {dialog}
    </>
  );
}

// ── next step ───────────────────────────────────────────────────────────────

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function NextStepBlock({
  deal,
  emails,
  today,
  busy,
  onSave,
}: {
  deal: Deal;
  emails: { subject: string | null }[];
  today: string;
  busy: boolean;
  onSave: (b: DealPatchBody) => void;
}) {
  const n = nextStepText(deal);
  const theirs = deal.next_step_owner === "them";
  const suggestion = deal.insights?.recommended_move;
  const canDone = !!deal.next_step || !!deal.follow_up_at || deal.follow_up_needed;
  const lastSubject = emails[0]?.subject ?? null;

  return (
    <section className={css.nextBlock} data-who={theirs ? "them" : "us"}>
      <div className={css.nextHead}>
        <h3 className={css.sectionTitle}>{theirs ? "Waiting on them" : "Your move"}</h3>
        <div className={css.whoSeg} role="group" aria-label="Who acts next">
          <button type="button" data-on={!theirs} onClick={() => onSave({ next_step_owner: "us" })} disabled={busy}>
            Us
          </button>
          <button type="button" data-on={theirs} onClick={() => onSave({ next_step_owner: "them" })} disabled={busy}>
            Them
          </button>
        </div>
      </div>
      <InlineText
        className={css.nextInput}
        value={deal.next_step ?? ""}
        placeholder={n.who === "none" ? "What happens next? e.g. Send the price list" : n.text}
        ariaLabel="Next step"
        onSave={(v) => onSave({ next_step: v })}
      />
      {deal.follow_up_reason && deal.follow_up_needed && !deal.follow_up_at && <p className={css.muted}>{deal.follow_up_reason}</p>}
      {!deal.next_step && suggestion && (
        <p className={css.suggest}>
          Suggested: {suggestion}{" "}
          <button type="button" className={css.linkBtn} onClick={() => onSave({ next_step: suggestion })}>
            Use this
          </button>
        </p>
      )}
      <div className={css.nextRow}>
        <label className={css.dateField}>
          <span>Follow up on</span>
          <input
            type="date"
            className={css.input}
            value={deal.follow_up_at ?? ""}
            min={today}
            onChange={(e) => onSave({ follow_up_at: e.target.value || null })}
          />
        </label>
        <div className={css.quickDates}>
          <button type="button" className={css.chipBtn} onClick={() => onSave({ follow_up_at: addDays(today, 1) })} disabled={busy}>
            Tomorrow
          </button>
          <button type="button" className={css.chipBtn} onClick={() => onSave({ follow_up_at: addDays(today, 3) })} disabled={busy}>
            In 3 days
          </button>
          <button type="button" className={css.chipBtn} onClick={() => onSave({ follow_up_at: addDays(today, 7) })} disabled={busy}>
            Next week
          </button>
        </div>
      </div>
      <div className={css.nextActions}>
        {canDone && (
          <button type="button" className="pm2-btn dark" disabled={busy} onClick={() => onSave({ done: true })}>
            Done
          </button>
        )}
        {deal.contact_email && (
          <a
            className="pm2-btn"
            href={`mailto:${deal.contact_email}${lastSubject ? `?subject=${encodeURIComponent(`Re: ${lastSubject}`)}` : ""}`}
          >
            <Mail size={15} aria-hidden /> Write the email
          </a>
        )}
      </div>
    </section>
  );
}

// ── activity ────────────────────────────────────────────────────────────────

function ActivityComposer({ dealId }: { dealId: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ActivityKind>("note");
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/activity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save");
      return d;
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["deal", dealId] });
    },
  });
  const placeholder: Record<string, string> = {
    note: "Write a note for the team…",
    call: "What came out of the call?",
    whatsapp: "What was said on WhatsApp?",
    meeting: "What was agreed in the meeting?",
  };
  return (
    <form
      className={css.composer}
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim() && !add.isPending) add.mutate();
      }}
    >
      <div className={css.kindChips} role="group" aria-label="What are you logging">
        {LOGGABLE_KINDS.map((k) => (
          <button key={k} type="button" className={css.chipBtn} data-on={kind === k} onClick={() => setKind(k)}>
            {k === "call" ? "Log a call" : k === "whatsapp" ? "WhatsApp" : k === "meeting" ? "Meeting" : "Note"}
          </button>
        ))}
      </div>
      <textarea className={css.textarea} value={body} rows={3} maxLength={4000} placeholder={placeholder[kind]} onChange={(e) => setBody(e.target.value)} />
      <div className={css.composerFoot}>
        {add.error instanceof Error && <span className={css.err}>{add.error.message}</span>}
        <button type="submit" className="pm2-btn pri" disabled={!body.trim() || add.isPending}>
          {add.isPending ? "Saving…" : "Add to log"}
        </button>
      </div>
    </form>
  );
}

const ACT_TONE: Record<ActivityKind, "grey" | "blue" | "green" | "teal" | "amber" | "purple"> = {
  note: "grey",
  call: "teal",
  whatsapp: "green",
  meeting: "purple",
  email: "blue",
  stage: "amber",
  system: "grey",
};

function ActivityTimeline({
  activity,
  notes,
  people,
  loading,
}: {
  activity: DealActivity[];
  notes: string | null;
  people: TeamPerson[];
  loading: boolean;
}) {
  if (loading) return <p className={css.muted}>Loading activity…</p>;
  if (!activity.length && !notes) return <p className={css.muted}>Nothing logged yet. Notes, calls and stage moves show up here.</p>;
  return (
    <ol className={css.timeline}>
      {activity.map((a) => (
        <li key={a.id} className={css.tItem}>
          <div className={css.tHead}>
            <Tag tone={ACT_TONE[a.kind]} size="sm">
              {ACTIVITY_LABEL[a.kind]}
            </Tag>
            <span className={css.tWho}>{authorName(a.author, people)}</span>
            <time className={css.tWhen} dateTime={a.created_at}>
              {dateTime(a.created_at)}
            </time>
          </div>
          <p className={css.tBody}>{a.body}</p>
        </li>
      ))}
      {notes && (
        <li className={css.tItem}>
          <div className={css.tHead}>
            <Tag tone="grey" size="sm">
              Notes
            </Tag>
          </div>
          <p className={css.tBody}>{notes}</p>
        </li>
      )}
    </ol>
  );
}

function authorName(a: string | null, people: TeamPerson[]): string {
  if (!a) return "";
  if (a === "scanner") return "Inbox check";
  if (a === "bulk_form") return "Bulk form";
  if (a === "imported") return "Earlier notes";
  return personName(a, people) ?? a;
}

// ── emails ──────────────────────────────────────────────────────────────────

function EmailList({ emails }: { emails: DealDetailResponse["emails"] }) {
  const [open, setOpen] = useState(false);
  if (!emails.length) return null;
  return (
    <section className={css.section}>
      <button type="button" className={css.collapse} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
        Emails <span className={css.laneN}>{emails.length}</span>
      </button>
      {open && (
        <ol className={css.timeline}>
          {emails.map((m) => (
            <li key={m.id} className={css.tItem}>
              <div className={css.tHead}>
                <Tag tone={m.direction === "inbound" ? "blue" : "green"} size="sm">
                  {m.direction === "inbound" ? "From them" : "From us"}
                </Tag>
                <span className={css.tWho}>{m.direction === "inbound" ? m.from_email : m.to_email}</span>
                <time className={css.tWhen}>{dateTime(m.sent_at)}</time>
              </div>
              <p className={css.tBody}>
                <b>{m.subject || "(no subject)"}</b>
                {m.snippet ? ` ${m.snippet}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── merge / delete ──────────────────────────────────────────────────────────

function DangerZone({ deal, allDeals, onDone }: { deal: Deal; allDeals: Deal[]; onDone: (openId?: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mergeInto, setMergeInto] = useState("");
  const [confirmMerge, setConfirmMerge] = useState(false);
  const targets = useMemo(
    () => allDeals.filter((d) => d.id !== deal.id).sort((a, b) => a.company_name.localeCompare(b.company_name)),
    [allDeals, deal.id],
  );
  const target = targets.find((d) => d.id === mergeInto) ?? null;

  const del = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not delete");
    },
    onSuccess: () => onDone(),
  });
  const merge = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/deals/${deal.id}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ into: mergeInto }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not merge");
    },
    onSuccess: () => onDone(mergeInto),
  });

  return (
    <section className={css.danger}>
      <div className={css.mergeRow}>
        <label className={css.dateField}>
          <span>Same business as another deal?</span>
          <select className={css.input} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
            <option value="">Merge into…</option>
            {targets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.company_name} ({STAGE_LABEL[d.stage]})
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="pm2-btn" disabled={!mergeInto || merge.isPending} onClick={() => setConfirmMerge(true)}>
          Merge
        </button>
      </div>
      <button type="button" className={css.deleteBtn} onClick={() => setConfirmDelete(true)}>
        <Trash2 size={15} aria-hidden /> Delete this deal
      </button>
      {(del.error instanceof Error || merge.error instanceof Error) && (
        <p className={css.err}>{(del.error ?? merge.error)?.message}</p>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${deal.company_name}?`}
          body="The deal and its activity log are removed for everyone. Emails stay in the mailbox. Nobody is messaged."
          confirmLabel="Delete deal"
          danger
          busy={del.isPending}
          onConfirm={() => del.mutate()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {confirmMerge && target && (
        <ConfirmDialog
          title={`Merge into ${target.company_name}?`}
          body={`Emails, activity and contact details from ${deal.company_name} move to ${target.company_name}, then this deal is removed. Nobody is messaged.`}
          confirmLabel="Merge"
          busy={merge.isPending}
          onConfirm={() => merge.mutate()}
          onClose={() => setConfirmMerge(false)}
        />
      )}
    </section>
  );
}

// ── small building blocks ───────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={css.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Looks like text, edits in place, saves on blur or Enter (Esc undoes). */
function InlineText({
  value,
  onSave,
  placeholder,
  ariaLabel,
  className,
  id,
  inputMode,
}: {
  value: string;
  onSave: (v: string | null) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  id?: string;
  inputMode?: "text" | "email" | "tel" | "decimal";
}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => {
    const v = draft.trim();
    if (v !== value.trim()) onSave(v || null);
  };
  return (
    <input
      ref={ref}
      id={id}
      className={`${css.inline} ${className ?? ""}`}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      inputMode={inputMode}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          ref.current?.blur();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(value);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
    />
  );
}
