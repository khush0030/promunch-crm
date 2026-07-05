"use client";

// Sequences tab: index on the left, vertical-timeline builder for the selected
// sequence on the right. A sequence is Email -> wait N days -> Email…; a
// single step is a one-shot campaign.

import { useCallback, useEffect, useState } from "react";
import { Clock, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import styles from "@/app/dashboard/leads/leads.module.css";
import type { SequenceRow, SequenceStep, TemplateRow } from "./types";

const SEQ_STATUS_PILL: Record<string, { cls: string; label: string }> = {
  draft: { cls: "bg-gray", label: "Draft" },
  active: { cls: "bg-green", label: "Active" },
  paused: { cls: "bg-gold", label: "Paused" },
};

export default function SequencesView({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [seqRes, tplRes] = await Promise.all([
        fetch("/api/leads/sequences", { cache: "no-store" }),
        fetch("/api/leads/templates", { cache: "no-store" }),
      ]);
      const seqJson = await seqRes.json();
      const tplJson = await tplRes.json();
      if (!seqRes.ok) throw new Error(seqJson.error || "load failed");
      setSequences(seqJson.sequences ?? []);
      setTemplates(tplJson.templates ?? []);
      setSelectedId((prev) => prev ?? (seqJson.sequences?.[0]?.id ?? null));
    } catch (e) {
      toast.push({ kind: "error", text: `Sequences: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function createSequence() {
    if (!templates.length) {
      toast.push({ kind: "error", text: "Create a template first — sequences send templates." });
      return;
    }
    const name = prompt("Name the sequence (e.g. Diwali gifting pitch):");
    if (!name?.trim()) return;
    const res = await fetch("/api/leads/sequences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), steps: [{ template_id: templates[0].id, wait_days: 0 }] }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.push({ kind: "error", text: json.error || "create failed" });
      return;
    }
    setSelectedId(json.sequence.id);
    load();
    onChanged();
  }

  const selected = sequences.find((s) => s.id === selectedId) ?? null;

  if (loading) return <div className="pm-empty">Loading…</div>;

  return (
    <div className={styles.seqLayout}>
      <div className={styles.seqIndex}>
        <button type="button" className="pm-btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={createSequence}>
          <Plus size={14} /> New sequence
        </button>
        {sequences.length === 0 ? (
          <p className="pm-muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            No sequences yet. A sequence is the series of emails a list receives: intro, then
            follow-ups a few days apart. Replies stop it automatically.
          </p>
        ) : (
          sequences.map((s) => {
            const sp = SEQ_STATUS_PILL[s.status] ?? SEQ_STATUS_PILL.draft;
            const active = (s.enrollments.active ?? 0) + (s.enrollments.sending ?? 0);
            return (
              <button
                type="button"
                key={s.id}
                className={`${styles.seqIndexItem}${s.id === selectedId ? ` ${styles.seqIndexItemOn}` : ""}`}
                onClick={() => setSelectedId(s.id)}
              >
                <span className={styles.seqIndexName}>{s.name}</span>
                <span className="pm-dim" style={{ fontSize: 11.5 }}>
                  {s.steps.length} step{s.steps.length === 1 ? "" : "s"}
                  {active ? ` · ${active} in flight` : ""}
                </span>
                <span className={`pm-badge2 ${sp.cls}`}>{sp.label}</span>
              </button>
            );
          })
        )}
      </div>

      {selected ? (
        <SequenceBuilder
          key={selected.id}
          sequence={selected}
          templates={templates}
          onSaved={() => { load(); onChanged(); }}
        />
      ) : (
        <div className="pm-empty" style={{ flex: 1 }}>Pick or create a sequence.</div>
      )}
    </div>
  );
}

function SequenceBuilder({
  sequence, templates, onSaved,
}: {
  sequence: SequenceRow;
  templates: TemplateRow[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [steps, setSteps] = useState<SequenceStep[]>(sequence.steps);
  const [stopOnReply, setStopOnReply] = useState(sequence.stop_on_reply);
  const [aiPolish, setAiPolish] = useState(sequence.ai_polish);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const tplById = new Map(templates.map((t) => [t.id, t]));

  function mutate(fn: (prev: SequenceStep[]) => SequenceStep[]) {
    setSteps(fn);
    setDirty(true);
  }

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/sequences/${sequence.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stop_on_reply: stopOnReply,
          ai_polish: aiPolish,
          steps: steps.map((s) => ({ template_id: s.template_id, wait_days: s.wait_days })),
          ...extra,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "save failed");
      setDirty(false);
      toast.push({ kind: "success", text: "Sequence saved." });
      onSaved();
    } catch (e) {
      toast.push({ kind: "error", text: `Save: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    const next = sequence.status === "active" ? "paused" : "active";
    await save({ status: next });
  }

  const enroll = sequence.enrollments;
  const totalEnrolled = Object.values(enroll).reduce((a, b) => a + b, 0);

  return (
    <div className={styles.seqBuilder}>
      <div className={styles.seqBuilderHead}>
        <div>
          <b style={{ fontSize: 15 }}>{sequence.name}</b>{" "}
          <span className={`pm-badge2 ${(SEQ_STATUS_PILL[sequence.status] ?? SEQ_STATUS_PILL.draft).cls}`}>
            {(SEQ_STATUS_PILL[sequence.status] ?? SEQ_STATUS_PILL.draft).label}
          </span>
        </div>
        <div className={styles.toolbar}>
          {dirty && (
            <button type="button" className="pm-btn primary" disabled={busy} onClick={() => save()}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          )}
          <button type="button" className="pm-btn" disabled={busy} onClick={toggleStatus}>
            {sequence.status === "active" ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Activate</>}
          </button>
        </div>
      </div>

      <div className={styles.seqColumns}>
        <div className={styles.timeline}>
          {steps.map((step, i) => {
            const tpl = tplById.get(step.template_id);
            return (
              <div key={i}>
                {i > 0 && (
                  <div className={styles.waitRow}>
                    <span className={styles.waitLine} />
                    <label className={styles.waitChip}>
                      <Clock size={12} /> wait
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={step.wait_days}
                        onChange={(e) =>
                          mutate((prev) =>
                            prev.map((s, j) => (j === i ? { ...s, wait_days: Math.max(1, Number(e.target.value) || 1) } : s)),
                          )
                        }
                      />
                      days
                    </label>
                    <span className={styles.waitLine} />
                  </div>
                )}
                <div className={styles.stepCard}>
                  <div className={styles.stepHead}>
                    <span className={styles.stepNum}>{i + 1}</span>
                    <select
                      className="input"
                      value={step.template_id}
                      onChange={(e) =>
                        mutate((prev) => prev.map((s, j) => (j === i ? { ...s, template_id: e.target.value } : s)))
                      }
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {steps.length > 1 && (
                      <button
                        type="button"
                        className="pm-btn ghost"
                        style={{ padding: "4px 7px" }}
                        aria-label={`Remove step ${i + 1}`}
                        onClick={() => mutate((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  {tpl && (
                    <div className={styles.stepPreview}>
                      <b>{tpl.subject}</b>
                      <span>{tpl.body_text.slice(0, 140)}{tpl.body_text.length > 140 ? "…" : ""}</span>
                    </div>
                  )}
                  {typeof step.sent === "number" && step.sent > 0 && (
                    <div className="pm-dim" style={{ fontSize: 11.5, marginTop: 6 }}>{step.sent} sent from this step</div>
                  )}
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className={styles.addStep}
            onClick={() =>
              mutate((prev) => [
                ...prev,
                { position: prev.length, wait_days: 3, template_id: templates[0]?.id ?? "" },
              ])
            }
          >
            <Plus size={14} /> Add step
          </button>
        </div>

        <div className={styles.seqSettings}>
          <h4>Sequence settings</h4>
          <label className={styles.settingRow}>
            <span>Stop when a lead replies</span>
            <input type="checkbox" checked={stopOnReply} onChange={(e) => { setStopOnReply(e.target.checked); setDirty(true); }} />
          </label>
          <label className={styles.settingRow}>
            <span>AI-polish first line per lead</span>
            <input type="checkbox" checked={aiPolish} onChange={(e) => { setAiPolish(e.target.checked); setDirty(true); }} />
          </label>
          <h4 style={{ marginTop: 16 }}>Enrolled</h4>
          {totalEnrolled === 0 ? (
            <p className="pm-muted" style={{ fontSize: 12.5 }}>
              Nobody yet — open a list and hit “Enroll in sequence”.
            </p>
          ) : (
            <div className={styles.enrollStats}>
              {(["active", "sending", "completed", "replied", "bounced", "stopped"] as const).map((k) =>
                enroll[k] ? (
                  <div key={k} className={styles.settingRow}>
                    <span style={{ textTransform: "capitalize" }}>{k}</span>
                    <b>{enroll[k]}</b>
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
