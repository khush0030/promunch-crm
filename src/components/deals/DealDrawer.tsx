"use client";

// One deal, one clear story. The drawer answers three questions in order:
//   1. Where are we?      → clickable stage stepper + time-in-stage
//   2. Whose move is it?  → ball-in-court card (our action, or what we wait on)
//   3. What are they weighing? → AI read: willingness, drivers, risks, tone
// Everything else (summary, commercials, notes, edit, raw emails) sits below.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Hourglass, Mail, X, Zap } from "lucide-react";
import { StatusBadge } from "@/components/pm";
import {
  ALL_KINDS,
  ALL_STAGES,
  BOARD_STAGES,
  KIND_LABEL,
  KIND_TONE,
  STAGE_LABEL,
  TEMP_LABEL,
  TEMP_TONE,
} from "./constants";
import { daysSince, shortDate, timeAgo } from "./format";
import type { Deal, DealDetailResponse, DealEmail, DealKind, DealStage } from "./types";

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--pm-border)",
  borderRadius: "var(--pm-r3)",
  background: "var(--pm-card2)",
  color: "inherit",
  font: "inherit",
  fontSize: 12.5,
  padding: "7px 10px",
};
const flab: React.CSSProperties = {
  fontSize: 10.5,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--pm-hint)",
  fontWeight: 700,
  marginBottom: 4,
};

const TEMP_BAR: Record<string, string> = {
  hot: "var(--pm-terra)",
  warm: "var(--pm-gold)",
  cool: "var(--pm-blue)",
};

export function DealDrawer({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["deal", dealId],
    queryFn: async (): Promise<DealDetailResponse> => {
      const res = await fetch(`/api/deals/${dealId}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "failed to load deal");
      return d;
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,23,20,0.35)",
        zIndex: 60,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 96vw)",
          height: "100%",
          background: "var(--pm-card)",
          borderLeft: "1px solid var(--pm-border)",
          overflowY: "auto",
          padding: "20px 24px 40px",
        }}
      >
        {isLoading && <p style={{ color: "var(--pm-hint)" }}>Loading…</p>}
        {error instanceof Error && <p style={{ color: "var(--pm-terra)" }}>{error.message}</p>}
        {data?.deal && (
          <DrawerBody
            key={`${data.deal.id}:${data.deal.updated_at}`}
            deal={data.deal}
            emails={data.emails}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ── stage stepper ────────────────────────────────────────────────────────────

function StageStepper({
  deal, busy, onMove,
}: {
  deal: Deal;
  busy: boolean;
  onMove: (stage: DealStage) => void;
}) {
  const closed = deal.stage === "lost" || deal.stage === "dormant";
  const currentIdx = BOARD_STAGES.indexOf(deal.stage);
  const inStageDays = daysSince(deal.stage_updated_at);

  if (closed) {
    return (
      <div
        style={{
          marginTop: 16,
          background: "var(--pm-card2)",
          border: "1px solid var(--pm-border)",
          borderRadius: "var(--pm-r2)",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <StatusBadge tone={deal.stage === "lost" ? "terra" : "gray"}>{STAGE_LABEL[deal.stage]}</StatusBadge>
        <span style={{ fontSize: 12.5, color: "var(--pm-muted)" }}>
          Closed {timeAgo(deal.stage_updated_at)}. Nothing is expected from either side.
        </span>
        <button
          type="button"
          className="pm-btn ghost sm"
          disabled={busy}
          onClick={() => onMove("in_discussion")}
          style={{ marginLeft: "auto" }}
        >
          Reopen deal
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={flab}>Where this deal is</div>
        {inStageDays !== null && (
          <span style={{ fontSize: 11, color: "var(--pm-hint)" }}>
            in this stage {inStageDays <= 0 ? "since today" : `for ${inStageDays}d`}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
        {BOARD_STAGES.map((s, i) => {
          const done = i < currentIdx || deal.stage === "won";
          const current = s === deal.stage;
          return (
            <button
              key={s}
              type="button"
              disabled={busy || current}
              title={current ? "Current stage" : `Move to ${STAGE_LABEL[s]}`}
              onClick={() => onMove(s)}
              style={{
                flex: 1,
                background: "none",
                border: "none",
                padding: 0,
                cursor: current ? "default" : "pointer",
                font: "inherit",
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <span
                  style={{
                    flex: 1,
                    height: 3,
                    background: i === 0 ? "transparent" : done || current ? "var(--pm-green)" : "var(--pm-line)",
                  }}
                />
                <span
                  style={{
                    width: current ? 22 : 16,
                    height: current ? 22 : 16,
                    borderRadius: 999,
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: done ? "var(--pm-green)" : current ? "var(--pm-card)" : "var(--pm-card2)",
                    border: current ? "3px solid var(--pm-green)" : done ? "none" : "2px solid var(--pm-line)",
                    color: "#fff",
                  }}
                >
                  {done && <Check size={11} strokeWidth={3.5} />}
                </span>
                <span
                  style={{
                    flex: 1,
                    height: 3,
                    background:
                      i === BOARD_STAGES.length - 1 ? "transparent" : done ? "var(--pm-green)" : "var(--pm-line)",
                  }}
                />
              </div>
              <div
                style={{
                  marginTop: 5,
                  fontSize: 10.5,
                  lineHeight: 1.25,
                  textAlign: "center",
                  fontWeight: current ? 750 : 550,
                  color: current ? "var(--pm-ink)" : done ? "var(--pm-green)" : "var(--pm-hint)",
                  padding: "0 2px",
                }}
              >
                {STAGE_LABEL[s]}
              </div>
            </button>
          );
        })}
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 10.5, color: "var(--pm-hint)", textAlign: "center" }}>
        Click a stage to move the deal — the mail scanner respects manual moves.
      </p>
    </div>
  );
}

// ── ball in court ────────────────────────────────────────────────────────────

// Whose move is it? Explicit owner wins; otherwise an inbound last email means
// they are waiting on us, an outbound one means the ball is with them.
function ballOwner(deal: Deal): "us" | "them" {
  if (deal.next_step_owner) return deal.next_step_owner;
  return deal.last_email_direction === "inbound" ? "us" : "them";
}

function BallInCourt({
  deal, emails, busy, onFollowUpDone, onEdit,
}: {
  deal: Deal;
  emails: DealEmail[];
  busy: boolean;
  onFollowUpDone: () => void;
  onEdit: () => void;
}) {
  const closed = deal.stage === "lost" || deal.stage === "dormant";
  if (closed) return null;

  const owner = ballOwner(deal);
  const sinceLast = daysSince(deal.last_email_at);
  const ours = owner === "us";

  const lastSubject = emails.length ? emails[emails.length - 1].subject : null;
  const mailto = deal.contact_email
    ? `mailto:${deal.contact_email}${lastSubject ? `?subject=${encodeURIComponent(`Re: ${lastSubject}`)}` : ""}`
    : null;

  const action =
    deal.next_step ||
    deal.insights?.recommended_move ||
    (ours ? "Reply to their last email" : "Wait for their reply");

  const stale = !ours && sinceLast !== null && sinceLast >= 5;

  return (
    <div
      style={{
        marginTop: 16,
        background: ours ? "var(--pm-green-soft, #E9F1E6)" : "var(--pm-card2)",
        border: `1px solid ${ours ? "var(--pm-green)" : "var(--pm-border)"}`,
        borderRadius: "var(--pm-r2)",
        padding: "13px 15px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {ours ? (
          <Zap size={13} style={{ color: "var(--pm-green)" }} />
        ) : (
          <Hourglass size={13} style={{ color: "var(--pm-gold)" }} />
        )}
        <span style={{ ...flab, marginBottom: 0, color: ours ? "var(--pm-green)" : "var(--pm-hint)" }}>
          {ours ? "Your move" : "Waiting on them"}
        </span>
        {sinceLast !== null && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--pm-hint)" }}>
            last email {sinceLast <= 0 ? "today" : `${sinceLast}d ago`}
            {deal.last_email_direction ? (deal.last_email_direction === "inbound" ? " (theirs)" : " (ours)") : ""}
          </span>
        )}
      </div>

      <p style={{ margin: "7px 0 0", fontSize: 14, fontWeight: 650, lineHeight: 1.45 }}>{action}</p>

      {deal.follow_up_needed && deal.follow_up_reason && (
        <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--pm-muted)" }}>{deal.follow_up_reason}</p>
      )}
      {stale && (
        <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--pm-terra)", fontWeight: 600 }}>
          Quiet for {sinceLast}d — a short nudge keeps it warm.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
        {mailto && (
          <a className="pm-btn primary sm" href={mailto} style={{ textDecoration: "none" }}>
            <Mail size={13} /> {ours || stale ? "Write the email" : "Email them anyway"}
          </a>
        )}
        {deal.follow_up_needed && (
          <button type="button" className="pm-btn sm" disabled={busy} onClick={onFollowUpDone}>
            <Check size={13} /> Follow-up handled
          </button>
        )}
        <button type="button" className="pm-btn ghost sm" onClick={onEdit}>
          Edit next step
        </button>
      </div>
    </div>
  );
}

// ── drawer body ──────────────────────────────────────────────────────────────

function DrawerBody({ deal, emails, onClose }: { deal: Deal; emails: DealEmail[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<DealStage>(deal.stage);
  const [kind, setKind] = useState<DealKind>(deal.kind);
  const [nextStep, setNextStep] = useState(deal.next_step ?? "");
  const [owner, setOwner] = useState<"us" | "them" | "">(deal.next_step_owner ?? "");
  const [followUp, setFollowUp] = useState(deal.follow_up_needed);
  const [notes, setNotes] = useState(deal.notes ?? "");
  const [showEmails, setShowEmails] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "save failed");
      return d.deal as Deal;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deal", deal.id] });
      qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });

  const dirty = stage !== deal.stage ||
    kind !== deal.kind ||
    nextStep !== (deal.next_step ?? "") ||
    owner !== (deal.next_step_owner ?? "") ||
    followUp !== deal.follow_up_needed ||
    notes !== (deal.notes ?? "");

  const ins = deal.insights;
  const temp = deal.interest_temp;

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{deal.company_name}</h2>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge tone={KIND_TONE[deal.kind]}>{KIND_LABEL[deal.kind]}</StatusBadge>
            {temp && ins && (
              <StatusBadge tone={TEMP_TONE[temp]}>
                {TEMP_LABEL[temp]} · {ins.willingness}/100 willing
              </StatusBadge>
            )}
            {deal.contact_email && (
              <span style={{ fontSize: 12, color: "var(--pm-muted)" }}>
                {deal.contact_name ? `${deal.contact_name} · ` : ""}
                {deal.contact_email}
              </span>
            )}
          </div>
        </div>
        <button type="button" className="pm-btn ghost sm" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </div>

      {/* 1 · where we are */}
      <StageStepper deal={deal} busy={save.isPending} onMove={(s) => save.mutate({ stage: s })} />

      {/* 2 · whose move */}
      <BallInCourt
        deal={deal}
        emails={emails}
        busy={save.isPending}
        onFollowUpDone={() => save.mutate({ follow_up_needed: false })}
        onEdit={() => setShowEdit(true)}
      />

      {/* 3 · what they're weighing */}
      {ins ? (
        <div
          style={{
            marginTop: 14,
            border: "1px solid var(--pm-border)",
            borderRadius: "var(--pm-r2)",
            padding: "12px 14px",
          }}
        >
          <div style={flab}>Their side of the table</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--pm-line)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.min(100, Math.max(2, ins.willingness))}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: temp ? TEMP_BAR[temp] : "var(--pm-hint)",
                }}
              />
            </div>
            <span style={{ fontSize: 11.5, color: "var(--pm-hint)", whiteSpace: "nowrap" }}>
              {ins.willingness}/100 willing to buy
            </span>
          </div>
          {ins.sentiment && (
            <p style={{ margin: "9px 0 0", fontSize: 12.5, lineHeight: 1.5 }}>{ins.sentiment}</p>
          )}
          {(ins.drivers.length || ins.risks.length) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 10 }}>
              {ins.drivers.length > 0 && (
                <div>
                  <div style={flab}>They&apos;re evaluating</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: "var(--pm-muted)", lineHeight: 1.5 }}>
                    {ins.drivers.map((x) => <li key={x}>{x}</li>)}
                  </ul>
                </div>
              )}
              {ins.risks.length > 0 && (
                <div>
                  <div style={flab}>Could kill it</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: "var(--pm-muted)", lineHeight: 1.5 }}>
                    {ins.risks.map((x) => <li key={x}>{x}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
          {ins.emotions.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {ins.emotions.map((e) => (
                <span
                  key={e}
                  style={{
                    fontSize: 11,
                    padding: "2px 9px",
                    borderRadius: 999,
                    background: "var(--pm-card2)",
                    border: "1px solid var(--pm-border)",
                    color: "var(--pm-muted)",
                  }}
                >
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--pm-hint)" }}>
          AI read pending — the next mail scan fills in willingness, drivers and risks.
        </p>
      )}

      {/* the story so far */}
      {deal.summary && (
        <div style={{ marginTop: 16 }}>
          <div style={flab}>The story so far</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--pm-muted)" }}>{deal.summary}</p>
        </div>
      )}

      {deal.commercials && (
        <div style={{ marginTop: 14 }}>
          <div style={flab}>Commercials discussed</div>
          <p style={{ margin: 0, fontSize: 13 }}>{deal.commercials}</p>
        </div>
      )}
      {deal.samples_sent_at && (
        <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "var(--pm-muted)" }}>
          Samples sent {shortDate(deal.samples_sent_at)} ({timeAgo(deal.samples_sent_at)})
        </p>
      )}
      {deal.notes && !showEdit && (
        <div style={{ marginTop: 14 }}>
          <div style={flab}>Your notes</div>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--pm-muted)", whiteSpace: "pre-wrap" }}>{deal.notes}</p>
        </div>
      )}

      {/* Edit, collapsed by default */}
      <button
        type="button"
        onClick={() => setShowEdit(!showEdit)}
        style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--pm-hint)" }}
      >
        {showEdit ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Edit deal
      </button>
      {showEdit && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={flab}>Stage</div>
              <select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value as DealStage)} style={inputStyle}>
                {ALL_STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={flab}>Kind</div>
              <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as DealKind)} style={inputStyle}>
                {ALL_KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div>
              <div style={flab}>Next step</div>
              <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="What happens next?" style={inputStyle} />
            </div>
            <div>
              <div style={flab}>Who acts</div>
              <select aria-label="Who acts next" value={owner} onChange={(e) => setOwner(e.target.value as "us" | "them" | "")} style={inputStyle}>
                <option value="">Auto (last email)</option>
                <option value="us">Us</option>
                <option value="them">Them</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <input id="fu" type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
            <label htmlFor="fu" style={{ fontSize: 13 }}>Needs follow-up</label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={flab}>Notes (yours)</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context the emails don't capture…" rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="pm-btn primary sm"
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate({
                  ...(stage !== deal.stage ? { stage } : {}),
                  ...(kind !== deal.kind ? { kind } : {}),
                  ...(nextStep !== (deal.next_step ?? "") ? { next_step: nextStep } : {}),
                  ...(owner !== (deal.next_step_owner ?? "") ? { next_step_owner: owner || null } : {}),
                  ...(followUp !== deal.follow_up_needed ? { follow_up_needed: followUp } : {}),
                  ...(notes !== (deal.notes ?? "") ? { notes } : {}),
                })}
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
            {save.error instanceof Error && (
              <span style={{ color: "var(--pm-terra)", fontSize: 12 }}>{save.error.message}</span>
            )}
          </div>
        </div>
      )}

      {/* Emails, collapsed by default */}
      <button
        type="button"
        onClick={() => setShowEmails(!showEmails)}
        style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--pm-hint)" }}
      >
        {showEmails ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Emails ({emails.length})
      </button>
      {showEmails && (
        <div style={{ marginTop: 8, border: "1px solid var(--pm-line)", borderRadius: "var(--pm-r2)", padding: "4px 14px" }}>
          {emails.length === 0 && <p style={{ color: "var(--pm-hint)", fontSize: 12.5 }}>No emails linked yet.</p>}
          {emails.map((m) => (
            <div key={m.id} style={{ borderTop: "1px solid var(--pm-line)", padding: "9px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5, color: "var(--pm-hint)" }}>
                <span style={{ color: m.direction === "inbound" ? "var(--pm-blue)" : "var(--pm-green)", fontWeight: 700 }}>
                  {m.direction === "inbound" ? `← ${m.from_email ?? "them"}` : "→ us"}
                </span>
                <span>{shortDate(m.sent_at)}</span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 2 }}>{m.subject || "(no subject)"}</div>
              {m.snippet && <div style={{ fontSize: 12, color: "var(--pm-muted)", marginTop: 2 }}>{m.snippet}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
