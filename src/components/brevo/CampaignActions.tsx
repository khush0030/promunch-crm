"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Archive, Copy, Download, Mail, Pencil, PauseCircle, Send, Trash2, Unlock, Clock } from "lucide-react";
import { Card, Callout, ConfirmDialog, Pill } from "@/components/pm";
import type { PreflightResult } from "@/lib/brevo-campaign-actions";
import { getJson, sendJson, errorText, Note, field, inputStyle, useBrevoSettings, useInvalidate, dateTime, int } from "./format";

// Everything you can do to one Brevo campaign (email or SMS). Sending is a
// two-step flow: preflight (server runs the same guard the send will) then an
// explicit confirm that carries the recipient count back, so a stale dialog
// can't send to a list that has grown since it was opened.

type Channel = "email" | "sms";
type Pre = PreflightResult & { campaign: { id: number; name: string; status: string; modifiedAt: string | null } };

const EXPORT_TYPES: Record<Channel, [string, string][]> = {
  email: [
    ["all", "Everyone sent to"],
    ["openers", "Opened"],
    ["nonOpeners", "Didn't open"],
    ["clickers", "Clicked"],
    ["nonClickers", "Didn't click"],
    ["unsubscribed", "Unsubscribed"],
    ["hardBounces", "Hard bounced"],
    ["softBounces", "Soft bounced"],
  ],
  sms: [
    ["all", "Everyone sent to"],
    ["delivered", "Delivered"],
    ["answered", "Replied"],
    ["unsubscribed", "Unsubscribed"],
    ["hardBounces", "Hard bounced"],
    ["softBounces", "Soft bounced"],
  ],
};

export function CampaignActions({ channel, id, status, name }: { channel: Channel; id: number; status: string; name: string }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const settings = useBrevoSettings();
  const isOwner = settings.data?.isOwner === true;
  const base = channel === "email" ? `/api/brevo/campaigns/${id}` : `/api/brevo/sms/${id}`;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [sendMode, setSendMode] = useState<"send_now" | "schedule" | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [checked, setChecked] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "suspend" | "release">(null);
  const [phone, setPhone] = useState("");
  const [exportType, setExportType] = useState("all");
  const [reportTo, setReportTo] = useState("");

  const pre = useQuery({
    queryKey: ["brevo-preflight", channel, id, sendMode ?? "send_now"],
    queryFn: () => getJson<Pre>(`${base}/actions?action=${sendMode ?? "send_now"}`),
  });

  const refresh = () => invalidate(["brevo-preflight"], ["brevo-campaigns"], ["brevo-campaign", String(id)], ["brevo-sms"]);

  const run = async (action: string, extra: Record<string, unknown> = {}, okText = "Done") => {
    setBusy(action);
    setMsg(null);
    try {
      const r = await sendJson<Record<string, unknown>>(`${base}/actions`, "POST", { action, ...extra });
      const detail =
        action === "test" && Array.isArray(r.sentTo)
          ? `Test sent to ${(r.sentTo as string[]).join(", ")}`
          : action === "export_recipients"
            ? `Export started (job #${r.processId}). Brevo emails the file; progress is under Health → Background jobs.`
            : okText;
      setMsg({ tone: "ok", text: detail });
      await refresh();
      return true;
    } catch (e) {
      setMsg({ tone: "err", text: errorText(e) });
      await refresh();
      return false;
    } finally {
      setBusy(null);
    }
  };

  const doSend = async () => {
    if (!pre.data || !sendMode) return;
    const extra: Record<string, unknown> = { confirmCount: pre.data.recipientCount };
    if (sendMode === "schedule") extra.scheduledAt = new Date(scheduledAt).toISOString();
    const ok = await run(sendMode, extra, sendMode === "send_now" ? `Sending to up to ${int(pre.data.recipientCount)} people.` : `Scheduled for ${dateTime(extra.scheduledAt as string)}.`);
    if (ok) {
      setSendMode(null);
      setChecked(false);
    }
  };

  const doDelete = async () => {
    setBusy("delete");
    try {
      await sendJson(base, "DELETE");
      await invalidate(["brevo-campaigns"], ["brevo-sms"]);
      router.push(channel === "email" ? "/dashboard/marketing/email" : "/dashboard/marketing/email?tab=sms");
    } catch (e) {
      setMsg({ tone: "err", text: errorText(e) });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const editable = status === "draft" || status === "suspended";
  const live = ["queued", "scheduled", "inProcess", "in_process"].includes(status);
  const claim = pre.data?.claim;
  const schedOk = sendMode !== "schedule" || (scheduledAt && Date.parse(scheduledAt) > Date.now() + 5 * 60_000);

  return (
    <Card title="Actions" basis={channel === "sms" ? "SMS campaign" : "email campaign"}>
      <div style={{ display: "grid", gap: 14 }}>
        {claim && (
          <Callout
            tone={claim.result === "failed" ? "crit" : "plain"}
            title={claim.result === "failed" ? "Send didn't confirm" : claim.action === "schedule" ? "Scheduled from the dashboard" : "Sent from the dashboard"}
            body={`${claim.claimed_by}, ${dateTime(claim.claimed_at)}${claim.error ? `. ${claim.error}` : ""}`}
            action={
              isOwner && claim.result === "failed" ? (
                <button type="button" className="pm2-btn sm" onClick={() => setConfirm("release")}>
                  <Unlock size={14} /> Release lock
                </button>
              ) : undefined
            }
          />
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {channel === "email" && editable && (
            <Link className="pm2-btn sm" href={`/dashboard/marketing/email/${id}/edit`}>
              <Pencil size={14} /> Edit
            </Link>
          )}
          {editable && channel === "email" && (
            <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => run("test")}>
              <Mail size={14} /> {busy === "test" ? "Sending test…" : `Send test${settings.data ? ` to ${settings.data.settings.test_emails.length} address${settings.data.settings.test_emails.length === 1 ? "" : "es"}` : ""}`}
            </button>
          )}
          {editable && isOwner && (
            <>
              <button type="button" className="pm2-btn pri sm" disabled={busy != null} onClick={() => { setSendMode("send_now"); setChecked(false); }}>
                <Send size={14} /> Send now
              </button>
              <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => { setSendMode("schedule"); setChecked(false); }}>
                <Clock size={14} /> Schedule
              </button>
            </>
          )}
          {live && (
            <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => setConfirm("suspend")}>
              <PauseCircle size={14} /> Suspend
            </button>
          )}
          {channel === "email" && (
            <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => run("replicate", {}, "Duplicated. The copy is a new draft in the campaign list.")}>
              <Copy size={14} /> Duplicate
            </button>
          )}
          {status === "archive" ? (
            <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => run("unarchive", {}, "Unarchived.")}>
              <Archive size={14} /> Unarchive
            </button>
          ) : (
            !live && (
              <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => run("archive", {}, "Archived.")}>
                <Archive size={14} /> Archive
              </button>
            )
          )}
          {status === "draft" && (
            <button type="button" className="pm2-btn sm ghost" disabled={busy != null} onClick={() => setConfirm("delete")}>
              <Trash2 size={14} /> Delete draft
            </button>
          )}
        </div>

        {editable && channel === "sms" && (
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <label style={{ ...field, flex: "1 1 200px" }}>
              Test SMS to (must be a Brevo contact)
              <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="91XXXXXXXXXX" inputMode="numeric" />
            </label>
            <button type="button" className="pm2-btn sm" disabled={busy != null || !phone} onClick={() => run("test", { phoneNumber: phone })}>
              <Mail size={14} /> Send test SMS
            </button>
          </div>
        )}

        {editable && !isOwner && settings.data && <Note tone="muted">Only the owner can send or schedule. You can edit and send tests.</Note>}

        {editable && pre.data && !pre.data.tested && <Note tone="muted">No test of the current version yet. Sending needs one.</Note>}

        {sendMode && (
          <div style={{ border: "1px solid var(--pm-border)", borderRadius: 10, padding: 14, display: "grid", gap: 10 }}>
            <strong>{sendMode === "send_now" ? `Send "${name}" now` : `Schedule "${name}"`}</strong>
            {pre.isLoading || pre.isFetching ? (
              <div className="pm2-skel" />
            ) : pre.data ? (
              <>
                <div style={{ fontSize: 13.5 }}>
                  Goes to <strong>up to {int(pre.data.recipientCount)}</strong> people ({pre.data.syncTarget === "test" ? "test mode" : "live audience"}):{" "}
                  {pre.data.lists.map((l) => `${l.name} (${int(l.size)})`).join(", ") || "no lists"}. Blocklisted and unsubscribed contacts are skipped by Brevo.
                </div>
                {sendMode === "schedule" && (
                  <label style={field}>
                    Date and time (your timezone)
                    <input type="datetime-local" style={inputStyle} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                  </label>
                )}
                {pre.data.errors.length > 0 ? (
                  <Callout tone="crit" title="Can't send yet" body={pre.data.errors.join(" ")} />
                ) : (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                    <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                    I checked the test email and want this to reach up to {int(pre.data.recipientCount)} people.
                  </label>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="pm2-btn pri sm" disabled={!checked || pre.data.errors.length > 0 || busy != null || !schedOk} onClick={doSend}>
                    <Send size={14} /> {busy === sendMode ? "Working…" : sendMode === "send_now" ? `Send to up to ${int(pre.data.recipientCount)}` : "Schedule"}
                  </button>
                  <button type="button" className="pm2-btn sm" onClick={() => setSendMode(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <Note tone="err">{errorText(pre.error)}</Note>
            )}
          </div>
        )}

        {!editable && status !== "archive" && (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <label style={{ ...field, flex: 1 }}>
                Export recipients
                <select style={inputStyle} value={exportType} onChange={(e) => setExportType(e.target.value)}>
                  {EXPORT_TYPES[channel].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="pm2-btn sm" disabled={busy != null} onClick={() => run("export_recipients", { recipientsType: exportType })}>
                <Download size={14} /> Export
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <label style={{ ...field, flex: 1 }}>
                Email the report to
                <input style={inputStyle} value={reportTo} onChange={(e) => setReportTo(e.target.value)} placeholder="name@promunch.in, ..." />
              </label>
              <button type="button" className="pm2-btn sm" disabled={busy != null || !reportTo.trim()} onClick={() => run("send_report", { reportTo: reportTo.split(/[,\s]+/).filter(Boolean) }, "Report sent.")}>
                <Mail size={14} /> Send
              </button>
            </div>
          </div>
        )}

        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        {pre.data && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12 }}>
            <Pill tone={pre.data.tested ? "good" : "neu"}>{pre.data.tested ? "current version tested" : "not tested"}</Pill>
            <Pill tone={pre.data.syncTarget === "live" ? "warn" : "info"}>{pre.data.syncTarget === "live" ? "live audience" : "test mode"}</Pill>
          </div>
        )}
      </div>

      {confirm === "delete" && (
        <ConfirmDialog title="Delete this draft?" body={`"${name}" is removed from Brevo. This can't be undone.`} confirmLabel="Delete" danger busy={busy === "delete"} onConfirm={doDelete} onClose={() => setConfirm(null)} />
      )}
      {confirm === "suspend" && (
        <ConfirmDialog
          title="Suspend this campaign?"
          body="Brevo stops it. Emails already delivered can't be recalled. A suspended scheduled campaign can be edited and scheduled again."
          confirmLabel="Suspend"
          busy={busy === "suspend"}
          onConfirm={async () => {
            await run("suspend", {}, "Suspended.");
            setConfirm(null);
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "release" && (
        <ConfirmDialog
          title="Release the send lock?"
          body="Only do this after checking in Brevo that the campaign did NOT go out. The server re-checks Brevo and refuses if it was sent."
          confirmLabel="Release lock"
          busy={busy === "release_claim"}
          onConfirm={async () => {
            await run("release_claim", {}, "Lock released. You can send again after a new test.");
            setConfirm(null);
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </Card>
  );
}
