"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Mail, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Card, Callout, ConfirmDialog, KpiStrip, Kpi, Pill, Table } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import type { AutomationsResponse } from "@/app/api/brevo/automations/route";
import type { BrevoTemplate } from "@/app/api/brevo/templates/route";
import type { HealthResponse } from "@/app/api/brevo/health/route";
import type { EventsRunResult } from "@/lib/brevo-events";
import { getJson, sendJson, errorText, Note, field, inputStyle, int, dateTime, day, SectionView, ErrorCallout, useBrevoSettings, useInvalidate, settingsKey } from "./format";

const EVENT_HELP: [string, string][] = [
  ["order_placed", "every real order (creator seeds excluded). Properties: order_id, order_number, total, first_order, payment (COD/Prepaid), channel, items[]"],
  ["order_fulfilled", "when Shopify marks the order fulfilled"],
  ["order_cancelled", "when the order is cancelled"],
];

const SKIP_LABEL: Record<string, string> = {
  no_email: "no email on the order or matching contact",
  not_test_address: "not a test address (test mode)",
  no_crm_contact: "email not in CRM contacts",
  no_consent: "never opted in to marketing",
  unsubscribed: "unsubscribed",
  suppressed: "on the do-not-email list",
  not_active: "bounced / inactive",
  anonymized: "anonymized",
};

type TemplateForm = { id: number | null; name: string; subject: string; htmlContent: string; senderId: number | null; replyTo: string; tag: string; isActive: boolean };
const EMPTY_T: TemplateForm = { id: null, name: "", subject: "", htmlContent: "", senderId: null, replyTo: "hello@promunch.in", tag: "", isActive: true };

export function AutomationsTab() {
  const invalidate = useInvalidate();
  const settingsQ = useBrevoSettings();
  const q = useQuery({ queryKey: ["brevo-automations"], queryFn: () => getJson<AutomationsResponse>("/api/brevo/automations") });
  const templates = useQuery({ queryKey: ["brevo-templates"], queryFn: () => getJson<{ templates: BrevoTemplate[] }>("/api/brevo/templates") });
  const health = useQuery({ queryKey: ["brevo-health"], queryFn: () => getJson<HealthResponse>("/api/brevo/health") });
  const [dry, setDry] = useState<EventsRunResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [tform, setTform] = useState<TemplateForm | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "events"; on: boolean } | { kind: "delete"; t: BrevoTemplate }>(null);

  const isOwner = settingsQ.data?.isOwner === true;
  const senders = health.data?.senders.state === "ok" ? health.data.senders.data.filter((s) => s.active) : [];

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ tone: "ok", text: await fn() });
      await invalidate(["brevo-automations"], ["brevo-templates"], settingsKey);
      return true;
    } catch (e) {
      setMsg({ tone: "err", text: errorText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <div className="pm2-skel" />;
  if (q.isError || !q.data) return <ErrorCallout title="Couldn't load automations" error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;

  const recentCols: TableCol<AutomationsResponse["recent"][number]>[] = [
    { h: "Event", render: (r) => <code>{r.event_name}</code> },
    { h: "Email", render: (r) => r.email ?? "—" },
    { h: "Status", render: (r) => <Pill tone={r.status === "sent" ? "good" : r.status === "failed" ? "crit" : "neu"}>{r.status}</Pill> },
    { h: "When", render: (r) => dateTime(r.created_at) },
  ];
  const tCols: TableCol<BrevoTemplate>[] = [
    {
      h: "Template",
      render: (t) => (
        <>
          {t.name}
          <span className="sub">{t.subject}</span>
        </>
      ),
    },
    { h: "Status", render: (t) => <Pill tone={t.isActive ? "good" : "neu"}>{t.isActive ? "active" : "inactive"}</Pill> },
    { h: "Updated", render: (t) => day(t.modifiedAt) },
    {
      h: "",
      render: (t) => (
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          <button type="button" className="pm2-btn sm ghost" aria-label={`Preview ${t.name}`} onClick={() => setPreviewId(previewId === t.id ? null : t.id)}>
            <Eye size={14} />
          </button>
          <button
            type="button"
            className="pm2-btn sm ghost"
            aria-label={`Edit ${t.name}`}
            onClick={() => setTform({ id: t.id, name: t.name, subject: t.subject, htmlContent: t.htmlContent, senderId: t.sender?.id != null ? Number(t.sender.id) : null, replyTo: t.replyTo ?? "", tag: t.tag ?? "", isActive: t.isActive })}
          >
            <Pencil size={14} />
          </button>
          <button type="button" className="pm2-btn sm ghost" aria-label={`Send test of ${t.name}`} disabled={busy != null} onClick={() => act(`test-${t.id}`, async () => {
            const r = await sendJson<{ sentTo: string[] }>("/api/brevo/templates", "POST", { action: "test", id: t.id });
            return `Test of "${t.name}" sent to ${r.sentTo.join(", ")}.`;
          })}>
            <Mail size={14} />
          </button>
          {!t.isActive && (
            <button type="button" className="pm2-btn sm ghost" aria-label={`Delete ${t.name}`} onClick={() => setConfirm({ kind: "delete", t })}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];
  const previewT = templates.data?.templates.find((t) => t.id === previewId);

  return (
    <>
      <Callout
        tone="plain"
        title="How automations work"
        body="The CRM sends order events to Brevo. You build the automation itself in Brevo (Automations → Create → Start when a custom event happens), for example a welcome email on order_placed with first_order = true. Abandoned-cart email is NOT evented: the CRM's own cart flow sends it, so the two can never double up."
      />

      <Card
        title="Order events"
        basis={a.target === "live" ? "live audience" : "test mode: only test addresses"}
        right={<Pill tone={a.eventsEnabled ? "good" : "neu"}>{a.eventsEnabled ? "on" : "off"}</Pill>}
      >
        <div style={{ display: "grid", gap: 14 }}>
          {!a.migrated && <Callout tone="sun" title="Migration not applied" body="Apply 20260917100000_brevo_integration.sql first; it also schedules the 10-minute events job." />}
          <KpiStrip cols={3}>
            <Kpi label="Sent (7 days)" value={int(a.counts.sent7d)} sub={Object.entries(a.counts.byEvent).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"} />
            <Kpi label="Failed (7 days)" value={int(a.counts.failed7d)} sub="not retried, to avoid double emails" invert />
            <Kpi label="Brevo event log" value={a.brevoLog.state === "ok" ? int(a.brevoLog.data.count) : "—"} sub="events Brevo has received" />
          </KpiStrip>
          <div style={{ display: "grid", gap: 4, fontSize: 13.5 }}>
            {EVENT_HELP.map(([k, v]) => (
              <div key={k}>
                <code>{k}</code>: <span style={{ color: "var(--pm-muted)" }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="pm2-btn sm"
              disabled={busy != null}
              onClick={() =>
                act("dry", async () => {
                  const r = await sendJson<EventsRunResult>("/api/brevo/automations", "POST");
                  setDry(r);
                  return "Dry run done. Nothing was sent.";
                })
              }
            >
              <Search size={14} /> Dry run next tick
            </button>
            {isOwner && a.migrated && (
              <button type="button" className={`pm2-btn sm${a.eventsEnabled ? "" : " pri"}`} disabled={busy != null} onClick={() => setConfirm({ kind: "events", on: !a.eventsEnabled })}>
                {a.eventsEnabled ? "Turn events off" : "Turn events on"}
              </button>
            )}
          </div>
          {dry && (
            <div style={{ border: "1px solid var(--pm-border)", borderRadius: 10, padding: 12, fontSize: 13.5, display: "grid", gap: 6 }}>
              <strong>
                {int(dry.preview.length)} event{dry.preview.length === 1 ? "" : "s"} would be sent ({dry.considered} orders in the last 3 days, {dry.target})
              </strong>
              {Object.keys(dry.skipped).length > 0 && <div>Skipped: {Object.entries(dry.skipped).map(([k, v]) => `${v} ${SKIP_LABEL[k] ?? k}`).join(" · ")}</div>}
              {dry.preview.slice(0, 5).map((p) => (
                <div key={`${p.orderId}:${p.event}`}>
                  <code>{p.event}</code> → {p.email} (order {String(p.payload.event_properties.order_number ?? p.orderId)})
                </div>
              ))}
            </div>
          )}
          <Table cols={recentCols} rows={a.recent} rowKey={(r) => `${r.order_id}:${r.event_name}`} card={(r) => ({ title: r.event_name, value: r.status, meta: `${r.email ?? ""} · ${dateTime(r.created_at)}` })} empty="No events sent yet" />
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        </div>
      </Card>

      <Card
        title="Email templates"
        basis="used by Brevo automations and transactional email"
        right={
          <button type="button" className="pm2-btn pri sm" onClick={() => setTform({ ...EMPTY_T, senderId: senders.find((s) => s.email === "hello@promunch.in")?.id ?? senders[0]?.id ?? null })}>
            <Plus size={14} /> New template
          </button>
        }
      >
        {templates.isLoading ? (
          <div className="pm2-skel" />
        ) : templates.isError ? (
          <Note tone="err">{errorText(templates.error)}</Note>
        ) : (
          <Table cols={tCols} rows={templates.data?.templates ?? []} rowKey={(t) => t.id} card={(t) => ({ title: t.name, value: t.isActive ? "active" : "inactive", meta: t.subject })} empty="No templates" />
        )}
        {previewT && (
          <iframe title={`Preview of ${previewT.name}`} sandbox="" srcDoc={previewT.htmlContent} style={{ width: "100%", height: 460, marginTop: 12, border: "1px solid var(--pm-border)", borderRadius: 8, background: "#fff" }} />
        )}

        {tform && (
          <div style={{ border: "1px solid var(--pm-border)", borderRadius: 10, padding: 14, marginTop: 14, display: "grid", gap: 10 }}>
            <strong>{tform.id ? "Edit template" : "New template"}</strong>
            <div className="pm2-g2">
              <label style={field}>
                Name
                <input style={inputStyle} value={tform.name} onChange={(e) => setTform({ ...tform, name: e.target.value })} />
              </label>
              <label style={field}>
                Subject
                <input style={inputStyle} value={tform.subject} onChange={(e) => setTform({ ...tform, subject: e.target.value })} />
              </label>
              <label style={field}>
                Sender
                <select style={inputStyle} value={tform.senderId ?? ""} onChange={(e) => setTform({ ...tform, senderId: Number(e.target.value) })}>
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} &lt;{s.email}&gt;
                    </option>
                  ))}
                </select>
              </label>
              <label style={field}>
                Reply-to
                <input style={inputStyle} value={tform.replyTo} onChange={(e) => setTform({ ...tform, replyTo: e.target.value })} />
              </label>
            </div>
            <label style={field}>
              HTML (event data: {"{{ params.order_number }}"}, {"{{ params.items }}"}; contact: {"{{ contact.FIRSTNAME }}"})
              <textarea style={{ ...inputStyle, minHeight: 220, fontFamily: "var(--pm-mono, monospace)", fontSize: 12.5 }} value={tform.htmlContent} onChange={(e) => setTform({ ...tform, htmlContent: e.target.value })} />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
              <input type="checkbox" checked={tform.isActive} onChange={(e) => setTform({ ...tform, isActive: e.target.checked })} /> Active
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="pm2-btn pri sm"
                disabled={busy != null}
                onClick={async () => {
                  const ok = await act("template", async () => {
                    await sendJson("/api/brevo/templates", "POST", { action: tform.id ? "update" : "create", ...tform });
                    return "Template saved.";
                  });
                  if (ok) setTform(null);
                }}
              >
                Save template
              </button>
              <button type="button" className="pm2-btn sm" onClick={() => setTform(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Brevo's recent event log" basis="what Brevo has received, from any source">
        <SectionView s={a.brevoLog} gatedTitle="Event log unavailable">
          {(log) =>
            log.events.length === 0 ? (
              <div className="pm2-empty">No events in Brevo yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
                {log.events.map((e, i) => (
                  <div key={i}>
                    <code>{e.event_name ?? "event"}</code> · {e.email ?? String(e.identifiers?.email_id ?? e.contact_id ?? "")} · {dateTime(e.event_date)}
                  </div>
                ))}
              </div>
            )
          }
        </SectionView>
      </Card>

      {confirm?.kind === "events" && (
        <ConfirmDialog
          title={confirm.on ? "Turn order events on?" : "Turn order events off?"}
          body={
            confirm.on
              ? `Every 10 minutes new orders from the last 3 days are sent to Brevo (${a.target === "live" ? "consented customers" : "test addresses only"}). Any Brevo automation listening for these events will start emailing. Run a dry run first.`
              : "No new events are sent. Brevo automations already running are not affected."
          }
          confirmLabel={confirm.on ? "Turn on" : "Turn off"}
          danger={confirm.on && a.target === "live"}
          busy={busy === "events"}
          onConfirm={async () => {
            await act("events", async () => {
              await sendJson("/api/brevo/settings", "PUT", { events_enabled: confirm.on });
              return confirm.on ? "Events on." : "Events off.";
            });
            setConfirm(null);
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "delete" && (
        <ConfirmDialog
          title="Delete this template?"
          body={`"${confirm.t.name}" is removed from Brevo. Automations using it will break.`}
          confirmLabel="Delete"
          danger
          busy={busy === "delete"}
          onConfirm={async () => {
            await act("delete", async () => {
              await sendJson("/api/brevo/templates", "POST", { action: "delete", id: confirm.t.id });
              return "Template deleted.";
            });
            setConfirm(null);
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}
