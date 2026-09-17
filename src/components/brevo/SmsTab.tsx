"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Plus } from "lucide-react";
import { Card, Callout, ConfirmDialog, Pill, Table } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import type { SmsResponse, SmsCampaign } from "@/app/api/brevo/sms/route";
import type { AudienceResponse } from "@/app/api/brevo/audience/route";
import { smsParts } from "@/lib/brevo-sms";
import { getJson, sendJson, errorText, Note, field, inputStyle, int, dateTime, SectionView, ErrorCallout, useBrevoSettings, useInvalidate, settingsKey } from "./format";
import { CampaignActions } from "./CampaignActions";
import { STATUS_LABEL, STATUS_TONE } from "./CampaignsTab";

// Brevo SMS: campaigns (same test + guard + claim as email) and a
// transactional test. Everything that sends is blocked while SMS is off.

export function SmsTab() {
  const invalidate = useInvalidate();
  const settingsQ = useBrevoSettings();
  const q = useQuery({ queryKey: ["brevo-sms"], queryFn: () => getJson<SmsResponse>("/api/brevo/sms") });
  const audience = useQuery({ queryKey: ["brevo-audience"], queryFn: () => getJson<AudienceResponse>("/api/brevo/audience") });
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState<{ name: string; sender: string; content: string; unicodeEnabled: boolean; listIds: number[] } | null>(null);
  const [tx, setTx] = useState({ phoneNumber: "", sender: "", content: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<boolean | null>(null);

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ tone: "ok", text: await fn() });
      await invalidate(["brevo-sms"], settingsKey);
      return true;
    } catch (e) {
      setMsg({ tone: "err", text: errorText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <div className="pm2-skel" />;
  if (q.isError || !q.data) return <ErrorCallout title="Couldn't load SMS" error={q.error} onRetry={() => q.refetch()} />;
  const isOwner = settingsQ.data?.isOwner === true;
  const lists = audience.data?.lists.state === "ok" ? audience.data.lists.data : [];
  const enabled = q.data.enabled;

  const cols: TableCol<SmsCampaign>[] = [
    {
      h: "Campaign",
      render: (c) => (
        <>
          <button type="button" className="pm2-btn ghost sm" style={{ padding: 0 }} onClick={() => setOpen(open === c.id ? null : c.id)}>
            {c.name}
          </button>
          <span className="sub">{c.content.slice(0, 80)}</span>
        </>
      ),
    },
    { h: "Status", render: (c) => <Pill tone={STATUS_TONE[c.status] ?? "neu"}>{STATUS_LABEL[c.status] ?? c.status}</Pill> },
    { h: "Sender", render: (c) => c.sender },
    { h: "Date", render: (c) => dateTime(c.sentDate ?? c.scheduledAt ?? c.createdAt) },
    { h: "Delivered", num: true, render: (c) => (c.statistics?.sent ? `${int(c.statistics.delivered)} / ${int(c.statistics.sent)}` : "—") },
    { h: "Replies", num: true, render: (c) => (c.statistics?.sent ? int(c.statistics.answered) : "—") },
    { h: "Unsubs", num: true, render: (c) => (c.statistics?.sent ? int(c.statistics.unsubscriptions) : "—") },
  ];
  const openCampaign = q.data.campaigns.state === "ok" ? q.data.campaigns.data.find((c) => c.id === open) : undefined;

  return (
    <>
      <Callout
        tone={enabled ? "plain" : "sun"}
        title={enabled ? "SMS is on" : "SMS is switched off"}
        body={
          enabled
            ? "SMS campaigns can be sent after a test, with the same guard and one-send lock as email. Every marketing SMS carries a STOP opt-out."
            : "In India every SMS needs a DLT-registered sender ID (header) and approved content templates, and Brevo needs SMS credits. You can prepare drafts now; nothing can be sent until the owner turns SMS on."
        }
        action={
          isOwner && settingsQ.data?.settings ? (
            <button type="button" className="pm2-btn sm" onClick={() => setConfirmToggle(!enabled)}>
              {enabled ? "Turn SMS off" : "Turn SMS on"}
            </button>
          ) : undefined
        }
      />

      <Card
        title="SMS campaigns"
        right={
          <button type="button" className="pm2-btn pri sm" onClick={() => setForm({ name: "", sender: "", content: "PROMUNCH: ", unicodeEnabled: false, listIds: [] })}>
            <Plus size={14} /> New SMS campaign
          </button>
        }
      >
        <SectionView s={q.data.campaigns} gatedTitle="SMS isn't set up on this Brevo account">
          {(campaigns) => <Table cols={cols} rows={campaigns} rowKey={(c) => c.id} card={(c) => ({ title: c.name, value: STATUS_LABEL[c.status] ?? c.status, meta: c.content.slice(0, 60) })} empty="No SMS campaigns yet" />}
        </SectionView>

        {form && (
          <div style={{ border: "1px solid var(--pm-border)", borderRadius: 10, padding: 14, marginTop: 14, display: "grid", gap: 10 }}>
            <strong>New SMS campaign (saved as a draft)</strong>
            <div className="pm2-g2">
              <label style={field}>
                Name
                <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label style={field}>
                Sender ID (DLT header, up to 11 characters)
                <input style={inputStyle} value={form.sender} onChange={(e) => setForm({ ...form, sender: e.target.value })} placeholder="PRMNCH" />
              </label>
            </div>
            <label style={field}>
              Message (must match an approved DLT template)
              <textarea style={{ ...inputStyle, minHeight: 100 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </label>
            <Note tone="muted">
              {[...form.content].length} characters · {smsParts(form.content, form.unicodeEnabled)} SMS part{smsParts(form.content, form.unicodeEnabled) === 1 ? "" : "s"} per person · &quot;Reply STOP to opt out&quot; is added
            </Note>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
              <input type="checkbox" checked={form.unicodeEnabled} onChange={(e) => setForm({ ...form, unicodeEnabled: e.target.checked })} /> Unicode (Hindi, emoji). Shorter parts.
            </label>
            <div style={{ display: "grid", gap: 4, fontSize: 13.5 }}>
              Lists
              {lists.map((l) => (
                <label key={l.id} style={{ display: "flex", gap: 8 }}>
                  <input type="checkbox" checked={form.listIds.includes(l.id)} onChange={() => setForm({ ...form, listIds: form.listIds.includes(l.id) ? form.listIds.filter((x) => x !== l.id) : [...form.listIds, l.id] })} />
                  {l.name} ({int(l.uniqueSubscribers)})
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="pm2-btn pri sm"
                disabled={busy != null}
                onClick={async () => {
                  const ok = await act("create", async () => {
                    await sendJson("/api/brevo/sms", "POST", { action: "create", ...form });
                    return "SMS draft created.";
                  });
                  if (ok) setForm(null);
                }}
              >
                Save draft
              </button>
              <button type="button" className="pm2-btn sm" onClick={() => setForm(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      </Card>

      {openCampaign && <CampaignActions channel="sms" id={openCampaign.id} status={openCampaign.status} name={openCampaign.name} />}

      {isOwner && (
        <Card title="Transactional SMS test" basis="one SMS to one number, owner only">
          <div className="pm2-g3">
            <label style={field}>
              Mobile
              <input style={inputStyle} value={tx.phoneNumber} onChange={(e) => setTx({ ...tx, phoneNumber: e.target.value })} placeholder="91XXXXXXXXXX" inputMode="numeric" />
            </label>
            <label style={field}>
              Sender ID
              <input style={inputStyle} value={tx.sender} onChange={(e) => setTx({ ...tx, sender: e.target.value })} />
            </label>
            <label style={field}>
              Message
              <input style={inputStyle} value={tx.content} onChange={(e) => setTx({ ...tx, content: e.target.value })} />
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="pm2-btn sm"
              disabled={busy != null || !enabled || !tx.phoneNumber || !tx.sender || !tx.content}
              onClick={() =>
                act("tx", async () => {
                  const r = await sendJson<{ messageId: number }>("/api/brevo/sms", "POST", { action: "test_transactional", ...tx });
                  return `Sent (message #${r.messageId}).`;
                })
              }
            >
              <MessageSquare size={14} /> Send test SMS
            </button>
            {!enabled && <Note tone="muted">Turn SMS on first.</Note>}
          </div>
        </Card>
      )}

      {confirmToggle != null && (
        <ConfirmDialog
          title={confirmToggle ? "Turn SMS on?" : "Turn SMS off?"}
          body={confirmToggle ? "Only do this once the DLT sender ID and templates are approved and Brevo has SMS credits. SMS campaigns still need a test and the send confirmation." : "No SMS can be sent from the dashboard until it's turned back on."}
          confirmLabel={confirmToggle ? "Turn on" : "Turn off"}
          busy={busy === "toggle"}
          onConfirm={async () => {
            await act("toggle", async () => {
              await sendJson("/api/brevo/settings", "PUT", { sms_enabled: confirmToggle });
              return confirmToggle ? "SMS on." : "SMS off.";
            });
            setConfirmToggle(null);
          }}
          onClose={() => setConfirmToggle(null)}
        />
      )}
    </>
  );
}
