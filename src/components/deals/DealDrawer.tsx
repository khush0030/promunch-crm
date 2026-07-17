"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { StatusBadge } from "@/components/pm";
import { ALL_KINDS, ALL_STAGES, KIND_LABEL, KIND_TONE, STAGE_LABEL } from "./constants";
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

// Right-side drawer: AI summary + email timeline, with editable fields.
// Manual stage edits win over the scanner (manual_stage_override).
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
          width: "min(680px, 96vw)",
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
          // keyed on updated_at so a background refetch re-seeds the form
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

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{deal.company_name}</h2>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge tone={KIND_TONE[deal.kind]}>{KIND_LABEL[deal.kind]}</StatusBadge>
            {deal.company_domain && <StatusBadge tone="gray">{deal.company_domain}</StatusBadge>}
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 18 }}>
        <div>
          <div style={flab}>Stage</div>
          <select value={stage} onChange={(e) => setStage(e.target.value as DealStage)} style={inputStyle}>
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={flab}>Kind</div>
          <select value={kind} onChange={(e) => setKind(e.target.value as DealKind)} style={inputStyle}>
            {ALL_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {deal.summary && (
        <div style={{ marginTop: 16 }}>
          <div style={flab}>Summary (AI)</div>
          <p style={{ margin: 0, fontSize: 13 }}>{deal.summary}</p>
        </div>
      )}
      {deal.commercials && (
        <div style={{ marginTop: 16 }}>
          <div style={flab}>Commercials discussed</div>
          <p style={{ margin: 0, fontSize: 13 }}>{deal.commercials}</p>
        </div>
      )}
      {deal.samples_sent_at && (
        <div style={{ marginTop: 16 }}>
          <div style={flab}>Samples</div>
          <p style={{ margin: 0, fontSize: 13 }}>
            Sent {shortDate(deal.samples_sent_at)} ({timeAgo(deal.samples_sent_at)})
          </p>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={flab}>Next step</div>
        <input
          value={nextStep}
          onChange={(e) => setNextStep(e.target.value)}
          placeholder="What happens next?"
          style={inputStyle}
        />
      </div>

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <input id="fu" type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
        <label htmlFor="fu" style={{ fontSize: 13 }}>
          Needs follow-up
          {deal.follow_up_reason ? <span style={{ color: "var(--pm-muted)" }}> — {deal.follow_up_reason}</span> : null}
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={flab}>Notes (yours)</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Context the emails don't capture…"
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          className="pm-btn primary"
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

      <div style={{ ...flab, marginTop: 26 }}>Email timeline ({emails.length})</div>
      <div style={{ border: "1px solid var(--pm-line)", borderRadius: "var(--pm-r2)", padding: "4px 14px" }}>
        {emails.length === 0 && <p style={{ color: "var(--pm-hint)", fontSize: 12.5 }}>No emails linked yet.</p>}
        {emails.map((m) => (
          <div key={m.id} style={{ borderTop: "1px solid var(--pm-line)", padding: "9px 0" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                fontSize: 11.5,
                color: "var(--pm-hint)",
              }}
            >
              <span
                style={{
                  color: m.direction === "inbound" ? "var(--pm-blue)" : "var(--pm-green)",
                  fontWeight: 700,
                }}
              >
                {m.direction === "inbound" ? `← ${m.from_email ?? "them"}` : "→ us"}
              </span>
              <span>{shortDate(m.sent_at)}</span>
            </div>
            <div style={{ fontSize: 12.5, marginTop: 2 }}>{m.subject || "(no subject)"}</div>
            {m.snippet && <div style={{ fontSize: 12, color: "var(--pm-muted)", marginTop: 2 }}>{m.snippet}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
