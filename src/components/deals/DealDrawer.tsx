"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { StatusBadge } from "@/components/pm";
import {
  ALL_KINDS,
  ALL_STAGES,
  KIND_LABEL,
  KIND_TONE,
  STAGE_LABEL,
  TEMP_LABEL,
  TEMP_TONE,
} from "./constants";
import { shortDate, timeAgo } from "./format";
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

// The whole picture for one deal: how willing they are (AI reads the tone of
// the thread), what they care about, what to do next — emails collapsed below.
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

function DrawerBody({ deal, emails, onClose }: { deal: Deal; emails: DealEmail[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<DealStage>(deal.stage);
  const [kind, setKind] = useState<DealKind>(deal.kind);
  const [nextStep, setNextStep] = useState(deal.next_step ?? "");
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
            <StatusBadge tone="gray">{STAGE_LABEL[deal.stage]}</StatusBadge>
            {temp && ins && (
              <StatusBadge tone={TEMP_TONE[temp]}>
                {TEMP_LABEL[temp]} · {ins.willingness}/100
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

      {/* Willingness meter */}
      {ins && (
        <div style={{ marginTop: 14 }}>
          <div style={{ height: 6, borderRadius: 999, background: "var(--pm-line)", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, Math.max(2, ins.willingness))}%`,
                height: "100%",
                borderRadius: 999,
                background: temp ? { hot: "var(--pm-terra)", warm: "var(--pm-gold)", cool: "var(--pm-blue)" }[temp] : "var(--pm-hint)",
              }}
            />
          </div>
        </div>
      )}

      {/* The picture */}
      {deal.summary && (
        <div style={{ marginTop: 16 }}>
          <div style={flab}>Where it stands</div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>{deal.summary}</p>
        </div>
      )}

      {ins?.sentiment && (
        <div style={{ marginTop: 14 }}>
          <div style={flab}>How they sound</div>
          <p style={{ margin: 0, fontSize: 13 }}>{ins.sentiment}</p>
          {ins.emotions.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
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
      )}

      {(ins?.drivers.length || ins?.risks.length) ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          {ins.drivers.length > 0 && (
            <div>
              <div style={flab}>What they care about</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: "var(--pm-muted)" }}>
                {ins.drivers.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
          )}
          {ins.risks.length > 0 && (
            <div>
              <div style={flab}>Watch out</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: "var(--pm-muted)" }}>
                {ins.risks.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {(ins?.recommended_move || deal.next_step) && (
        <div
          style={{
            marginTop: 16,
            background: "var(--pm-green-soft, #E9F1E6)",
            border: "1px solid var(--pm-border)",
            borderRadius: "var(--pm-r2)",
            padding: "12px 14px",
          }}
        >
          <div style={{ ...flab, color: "var(--pm-green)" }}>Your move</div>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
            {ins?.recommended_move || deal.next_step}
          </p>
          {deal.follow_up_reason && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--pm-muted)" }}>{deal.follow_up_reason}</p>
          )}
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
      {!ins && (
        <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--pm-hint)" }}>
          Sentiment analysis pending — the next scan fills this in.
        </p>
      )}

      {/* Edit, collapsed by default */}
      <button
        type="button"
        onClick={() => setShowEdit(!showEdit)}
        style={{ ...flab, marginTop: 22, display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--pm-hint)" }}
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
          <div style={{ marginTop: 12 }}>
            <div style={flab}>Next step</div>
            <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="What happens next?" style={inputStyle} />
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
