"use client";

// Automations: the always-on email flows (abandoned cart, welcome,
// post-purchase, replenishment). See each flow's rules and stats, send
// yourself a test of every email, and (admins) switch a flow on or off.
// Each automation opens in the editor at /dashboard/email/automations/[id].

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, ChevronDown, ChevronUp, Hand, HeartCrack, Mail, PackageCheck, Pencil, Plus, Send, ShoppingCart, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Callout, ConfirmDialog } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { getJson, sendJson, pct, when } from "@/components/email-studio/api";
import { delayLabel, type FlowStats } from "@/lib/email-studio/automations";
import { friendlyText } from "@/lib/email-studio/visual-edit";
import s from "@/components/email-studio/studio.module.css";
import l from "@/components/email-studio/list.module.css";

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

const STATUS: Record<string, { cls: string; label: string }> = {
  active: { cls: l.stGood, label: "On" },
  paused: { cls: l.stWarn, label: "Paused" },
  draft: { cls: l.stNeu, label: "Draft" },
};

const ICONS: Record<string, LucideIcon> = {
  checkout_abandoned: ShoppingCart,
  order_placed: PackageCheck,
  customer_created: Hand,
  segment_entry: HeartCrack,
  date_based: CalendarHeart,
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
  const liveCount = flows.filter((f) => f.status === "active").length;
  // Which rows show their email list (UI only).
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <StudioHeader
        tab="automations"
        title="Automations"
        summary={
          flows.length ? (
            <>
              {flows.length} always-on {flows.length === 1 ? "email" : "emails"}, <b>{liveCount} on</b>. They go out by themselves when something happens, only to people with an email who have not unsubscribed.
            </>
          ) : (
            "Always-on emails that go out by themselves when something happens."
          )
        }
        actions={
          <button type="button" className="pm2-btn" disabled={busy !== null} onClick={() => setCreating((v) => !v)}>
            <Plus size={14} /> New automation
          </button>
        }
      />
      <div className="pm2-body">
        {q.error && <Callout tone="crit" title="Could not load automations" body={(q.error as Error).message} />}
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
        {q.isLoading && <div className="pm2-skel" />}
        {GROUPS.map((g) => {
          const list = flows.filter((f) => f.trigger_type === g.trigger);
          if (list.length === 0) return null;
          const Icon = ICONS[g.trigger] ?? Mail;
          return (
            <section key={g.trigger} style={{ display: "grid", gap: 12 }}>
              <span className={l.group}>{g.title}</span>
              <div className={l.list}>
                {list.map((f) => {
                  const st = STATUS[f.status] ?? { cls: l.stNeu, label: f.status };
                  const on = f.status === "active";
                  const isOpen = open.has(f.id);
                  return (
                    <div key={f.id} className={l.lrow}>
                      <span className={l.lic}><Icon /></span>
                      <div className={l.ltx}>
                        <a href={`/dashboard/email/automations/${f.id}`} className={l.name} style={{ fontSize: 16 }}>{f.name}</a>
                        {f.description && <span>{f.description}</span>}
                        <div className={l.lstats}>
                          <span><b>{f.steps.length}</b> email{f.steps.length === 1 ? "" : "s"}</span>
                          <span><b>{f.stats.sent.toLocaleString("en-IN")}</b> sent</span>
                          {f.stats.sent > 0 && <span><b>{pct(f.stats.opened / f.stats.sent)}</b> opened</span>}
                          {f.stats.sent > 0 && <span><b>{pct(f.stats.clicked / f.stats.sent)}</b> clicked</span>}
                          <span><b>{f.stats.active.toLocaleString("en-IN")}</b> in it now</span>
                          {f.trigger_type === "checkout_abandoned" && <span><b>{f.stats.converted.toLocaleString("en-IN")}</b> bought after</span>}
                        </div>
                      </div>
                      <div className={l.lside}>
                        <span className={`${l.status} ${st.cls}`}>{st.label}</span>
                      </div>
                      <div className={l.lacts}>
                        <a className="pm2-btn" href={`/dashboard/email/automations/${f.id}`}><Pencil size={14} /> Edit emails</a>
                        <button type="button" className="pm2-btn ghost" disabled={busy !== null} onClick={() => test(f)}>
                          <Send size={14} /> {busy === `test:${f.id}` ? "Sending…" : "Send me all"}
                        </button>
                        {admin && (
                          <button type="button" className="pm2-btn ghost" disabled={busy !== null} onClick={() => setConfirm({ flow: f, to: on ? "paused" : "active" })}>
                            {on ? "Pause" : "Switch on"}
                          </button>
                        )}
                        {f.steps.length > 0 && (
                          <button type="button" className="pm2-btn ghost" aria-expanded={isOpen} onClick={() => toggle(f.id)}>
                            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {isOpen ? "Hide emails" : "Show emails"}
                          </button>
                        )}
                        {f.updated_at && <span className={l.lfoot}>Changed {when(f.updated_at)}</span>}
                      </div>
                      {isOpen && (
                        <div className={l.emails}>
                          {f.steps.map((step, i) => (
                            <a key={i} className={l.email} href={`/dashboard/email/automations/${f.id}?email=${i + 1}`} title="Open this email">
                              <span className={l.enum}>{i + 1}</span>
                              <span>{step.subject ? friendlyText(step.subject) : "No subject yet"}</span>
                              <span>{i === 0 ? "" : "+"}{delayLabel(step.delay_hours)}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!q.isLoading && flows.length === 0 && !q.error && (
          <div className={l.list}><div className={l.empty}>No automations yet.</div></div>
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
