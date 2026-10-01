"use client";

// Automations: the always-on email flows (abandoned cart, welcome,
// post-purchase, replenishment). See each flow's rules and stats, send
// yourself a test of every email, and (admins) switch a flow on or off.
// Each automation opens in the editor at /dashboard/email/automations/[id].

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Callout, ConfirmDialog, Pill } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { getJson, sendJson, pct, when } from "@/components/email-studio/api";
import { delayLabel, type FlowStats } from "@/lib/email-studio/automations";
import { friendlyText } from "@/lib/email-studio/visual-edit";
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

/** Automations grouped by the situation that starts them, in plain words. */
const GROUPS: { trigger: string; title: string }[] = [
  { trigger: "checkout_abandoned", title: "Someone leaves checkout" },
  { trigger: "order_placed", title: "After someone orders" },
  { trigger: "customer_created", title: "Someone signs up" },
  { trigger: "segment_entry", title: "Bring people back (browsed, lapsed, loyal, quiet)" },
  { trigger: "date_based", title: "Special dates" },
];

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
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const create = async (copyFrom?: string) => {
    setBusy("create");
    try {
      const r = await sendJson<{ id: string }>("/api/email-studio/flows", "POST", copyFrom ? { copyFrom } : {});
      router.push(`/dashboard/email/automations/${r.id}`);
    } catch (e) {
      toast.push({ kind: "error", text: (e as Error).message });
      setBusy(null);
    }
  };

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
      <StudioHeader
        tab="automations"
        title="Automations"
        actions={
          <button type="button" className="pm2-btn pri" disabled={busy !== null} onClick={() => setCreating((v) => !v)}>
            <Plus size={14} /> New automation
          </button>
        }
      />
      <div className="pm2-body">
        {q.error && <Callout tone="sun" title="Could not load automations" body={(q.error as Error).message} />}
        <Callout
          tone="plain"
          title="Always-on emails"
          body="These emails go out by themselves when something happens. Click any email to change its words, photos, buttons or offer. Save, then send yourself a test. Only people with an email who have not unsubscribed get them."
        />
        {creating && (
          <div className="pm2-panel" style={{ padding: 16, display: "grid", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Start a new automation</h3>
            <span className={s.hint}>It starts as a draft. Nothing sends until an admin switches it on.</span>
            <div className={s.row}>
              <button type="button" className="pm2-btn ghost" disabled={busy !== null} onClick={() => create()}>Start blank</button>
              {flows.map((f) => (
                <button key={f.id} type="button" className="pm2-btn ghost" disabled={busy !== null} onClick={() => create(f.id)}>Copy “{f.name}”</button>
              ))}
            </div>
          </div>
        )}
        {q.isLoading && <div className="pm2-panel" style={{ padding: 16 }}><span className={s.hint}>Loading…</span></div>}
        {GROUPS.map((g) => {
          const list = flows.filter((f) => f.trigger_type === g.trigger);
          if (list.length === 0) return null;
          return (
            <section key={g.trigger} style={{ display: "grid", gap: 8 }}>
              <span className={s.alGroup}>{g.title}</span>
              <div className={s.alGrid}>
                {list.map((f) => {
                  const st = STATUS[f.status] ?? { tone: "neu" as const, label: f.status };
                  const on = f.status === "active";
                  return (
                    <div key={f.id} className={`pm2-panel ${s.alCard}`}>
                      <div className={s.row} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                          <a href={`/dashboard/email/automations/${f.id}`} style={{ fontSize: 16, fontWeight: 750, color: "var(--pm-ink)", textDecoration: "none" }}>{f.name}</a>
                          {f.description && <span className={s.hint}>{f.description}</span>}
                        </div>
                        <Pill tone={st.tone}>{st.label}</Pill>
                      </div>
                      <div className={s.alEmails}>
                        {f.steps.map((step, i) => (
                          <a key={i} className={s.alEmail} href={`/dashboard/email/automations/${f.id}?email=${i + 1}`} title="Open this email">
                            <span className={s.aeNum}>{i + 1}</span>
                            <span>{step.subject ? friendlyText(step.subject) : "No subject yet"}</span>
                            <span className={s.hint}>{i === 0 ? "" : "+"}{delayLabel(step.delay_hours)}</span>
                          </a>
                        ))}
                      </div>
                      <div className={s.row} style={{ gap: 16 }}>
                        <Stat label="Sent" value={f.stats.sent} />
                        <Stat label="Opened" value={f.stats.sent ? pct(f.stats.opened / f.stats.sent) : "–"} />
                        <Stat label="Clicked" value={f.stats.sent ? pct(f.stats.clicked / f.stats.sent) : "–"} />
                        <Stat label="In it now" value={f.stats.active} />
                        {f.trigger_type === "checkout_abandoned" && <Stat label="Bought after" value={f.stats.converted} />}
                      </div>
                      <div className={s.row}>
                        <a className="pm2-btn pri" href={`/dashboard/email/automations/${f.id}`}><Pencil size={14} /> Edit emails</a>
                        <button type="button" className="pm2-btn ghost" disabled={busy !== null} onClick={() => test(f)}>
                          <Send size={14} /> {busy === `test:${f.id}` ? "Sending…" : "Send me all"}
                        </button>
                        {admin && (
                          <button type="button" className="pm2-btn ghost" disabled={busy !== null} onClick={() => setConfirm({ flow: f, to: on ? "paused" : "active" })}>
                            {on ? "Pause" : "Switch on"}
                          </button>
                        )}
                      </div>
                      {f.updated_at && <span className={s.hint}>Last changed {when(f.updated_at)}</span>}
                    </div>
                  );
                })}
              </div>
            </section>
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
