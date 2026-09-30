"use client";

// Automations: the always-on email flows (abandoned cart, welcome,
// post-purchase, replenishment). See each flow's rules and stats, send
// yourself a test of every email, and (admins) switch a flow on or off.
// Editing copy still lives in the legacy flow builder for now.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Pencil } from "lucide-react";
import { Callout, ConfirmDialog, Pill } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { getJson, sendJson, pct, when } from "@/components/email-studio/api";
import { delayLabel, type FlowStats } from "@/lib/email-studio/automations";
import s from "@/components/email-studio/studio.module.css";

type FlowDto = {
  id: string;
  name: string;
  description: string;
  trigger_type: string;
  status: string;
  rules: string[];
  steps: { delay_hours: number; subject: string }[];
  stats: FlowStats;
  updated_at: string | null;
};

const STATUS: Record<string, { tone: "good" | "warn" | "neu"; label: string }> = {
  active: { tone: "good", label: "On" },
  paused: { tone: "warn", label: "Paused" },
  draft: { tone: "neu", label: "Draft" },
};

export default function AutomationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["email-studio-flows"],
    queryFn: () => getJson<{ flows: FlowDto[]; admin: boolean }>("/api/email-studio/flows"),
  });
  const [confirm, setConfirm] = useState<{ flow: FlowDto; to: "active" | "paused" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const test = async (f: FlowDto) => {
    setBusy(`test:${f.id}`);
    try {
      const r = await sendJson<{ to: string[]; sent: unknown[]; source: string }>("/api/email-studio/flows/test", "POST", { flowId: f.id, step: "all" });
      toast.push({ kind: "success", text: `Sent ${r.sent.length} test email${r.sent.length === 1 ? "" : "s"} to ${r.to.join(", ")} (${r.source}).` });
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const flows = q.data?.flows ?? [];
  const admin = q.data?.admin ?? false;

  return (
    <>
      <StudioHeader tab="automations" title="Automations" />
      <div className="pm2-body">
        {q.error && <Callout tone="sun" title="Could not load automations" body={(q.error as Error).message} />}
        <Callout
          tone="plain"
          title="Always-on emails"
          body="Each automation emails people when something happens (a cart left behind, an order placed). Drafts send nothing. Send yourself a test before switching one on. Only people with an email who have not unsubscribed get these."
        />
        {q.isLoading && <div className="pm2-panel" style={{ padding: 16 }}><span className={s.hint}>Loading…</span></div>}
        {flows.map((f) => {
          const st = STATUS[f.status] ?? { tone: "neu" as const, label: f.status };
          const on = f.status === "active";
          return (
            <div key={f.id} className="pm2-panel" style={{ padding: 16, display: "grid", gap: 12 }}>
              <div className={s.row} style={{ justifyContent: "space-between" }}>
                <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  <div className={s.row}>
                    <b style={{ fontSize: 15.5 }}>{f.name}</b>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </div>
                  {f.description && <span className={s.hint}>{f.description}</span>}
                </div>
                <div className={s.row}>
                  <button type="button" className="pm2-btn ghost" disabled={busy !== null} onClick={() => test(f)}>
                    <Send size={14} /> {busy === `test:${f.id}` ? "Sending…" : "Send me a test"}
                  </button>
                  <a className="pm2-btn ghost" href={`/dashboard/flows/${f.id}`}><Pencil size={14} /> Edit emails</a>
                  {admin && (
                    <button
                      type="button"
                      className={on ? "pm2-btn ghost" : "pm2-btn pri"}
                      disabled={busy !== null}
                      onClick={() => setConfirm({ flow: f, to: on ? "paused" : "active" })}
                    >
                      {on ? "Pause" : "Switch on"}
                    </button>
                  )}
                </div>
              </div>

              <div className={s.row} style={{ gap: 6 }}>
                {f.rules.map((r) => <Pill key={r} tone="info" plain>{r}</Pill>)}
              </div>

              <div style={{ display: "grid", gap: 2 }}>
                {f.steps.map((step, i) => (
                  <div key={i} className={s.linkRow}>
                    <span>Email {i + 1} · <b style={{ color: "var(--pm-ink)" }}>{step.subject}</b></span>
                    <span className={s.hint}>{i === 0 ? "after" : "then after"} {delayLabel(step.delay_hours)}</span>
                  </div>
                ))}
              </div>

              <div className={s.row} style={{ gap: 18 }}>
                <Stat label="Entered" value={f.stats.entered} />
                <Stat label="In progress" value={f.stats.active} />
                <Stat label="Emails sent" value={f.stats.sent} />
                <Stat label="Opened" value={f.stats.sent ? pct(f.stats.opened / f.stats.sent) : "–"} />
                <Stat label="Clicked" value={f.stats.sent ? pct(f.stats.clicked / f.stats.sent) : "–"} />
                {f.trigger_type === "checkout_abandoned" && <Stat label="Bought after" value={f.stats.converted} />}
                {f.updated_at && <span className={s.hint}>Updated {when(f.updated_at)}</span>}
              </div>
            </div>
          );
        })}
        {!q.isLoading && flows.length === 0 && !q.error && (
          <div className="pm2-panel" style={{ padding: 16 }}><span className={s.hint}>No automations yet.</span></div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.to === "active" ? `Switch on "${confirm.flow.name}"?` : `Pause "${confirm.flow.name}"?`}
          body={
            confirm.to === "active"
              ? "Real customers start getting these emails from the next matching event. Make sure you have checked the test emails."
              : "No more emails go out from this automation. People already in it wait where they are and continue if you switch it back on."
          }
          confirmLabel={confirm.to === "active" ? "Switch on" : "Pause"}
          danger={confirm.to === "active"}
          busy={busy === "status"}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            setBusy("status");
            try {
              await sendJson(`/api/email-studio/flows/${confirm.flow.id}`, "PATCH", { status: confirm.to });
              qc.invalidateQueries({ queryKey: ["email-studio-flows"] });
              toast.push({ kind: "success", text: `"${confirm.flow.name}" is ${confirm.to === "active" ? "on" : "paused"}.` });
              setConfirm(null);
            } catch (e) {
              toast.push({ kind: "error", text: (e as Error).message });
            } finally {
              setBusy(null);
            }
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span className={s.hint}>{label}</span>
      <b style={{ fontSize: 15 }}>{typeof value === "number" ? value.toLocaleString("en-IN") : value}</b>
    </div>
  );
}
