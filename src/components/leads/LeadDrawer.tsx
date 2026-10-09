"use client";

// Everything about one business: its status, emails found, the email written
// for it (approve / don't send / rewrite), replies, history.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Ban, Check, Handshake, MailSearch, Plus, Sparkles, Trash2, X } from "lucide-react";
import { ConfirmDialog, Tag } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import { api, errText, shortDate, useB2bRefresh } from "./api";
import StageTag from "./StageTag";
import FindEmailsDialog from "./FindEmailsDialog";
import WriteDialog from "./WriteDialog";
import { makeDeal, useDealFor } from "./RepliesView";
import type { Lead, OutreachSettings } from "./types";

// This business's own path, matching the six steps on the page.
const TRACK = ["Found", "Has an email", "Email written", "Approved", "Sent", "Replied"];
const NO_EMAIL = ["new", "crawling", "listed", "no_contacts", "no_website"];
function trackAt(status: string): number {
  if (NO_EMAIL.includes(status)) return 1;
  if (status === "ready" || status === "drafting") return 2;
  if (status === "drafted") return 3;
  if (status === "approved") return 4;
  if (status === "contacted") return 5;
  if (status === "replied") return 6;
  return -1;
}

type LeadResponse = { lead: Lead; followUp: { status: string; current_step: number; next_send_at: string | null } | null };

export default function LeadDrawer({
  leadId, settings, isAdmin, onClose,
}: {
  leadId: string;
  settings: OutreachSettings | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const refreshAll = useB2bRefresh();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["b2b", "lead", leadId], queryFn: () => api<LeadResponse>(`/api/leads/${leadId}`) });
  const lead = q.data?.lead ?? null;
  const dealFor = useDealFor();
  const [busy, setBusy] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [dialog, setDialog] = useState<null | "find" | "write" | "suppress">(null);
  const [madeDeal, setMadeDeal] = useState<string | null | undefined>(undefined);

  const drafts = lead?.outreach_drafts ?? [];
  const live = drafts.find((d) => !d.enrollment_id && ["draft", "failed", "approved", "sending"].includes(d.status)) ?? null;
  const sent = drafts.filter((d) => d.sent_at).sort((a, b) => +new Date(b.sent_at!) - +new Date(a.sent_at!));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    setSubject(live?.subject ?? "");
    setBody(live?.body_text ?? "");
  }, [live?.id, live?.subject, live?.body_text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !dialog) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, dialog]);

  const refresh = () => {
    q.refetch();
    refreshAll();
  };

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
      refresh();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  const addEmail = () => run("contact", async () => {
    if (!lead) return;
    const r = await api<{ verifyStatus: string }>(`/api/leads/${lead.id}/contacts`, { body: { email: newEmail } });
    setNewEmail("");
    toast.push(r.verifyStatus === "mx_ok"
      ? { kind: "success", text: "Email added. This business is Ready, write the email next." }
      : { kind: "info", text: "Email added, but that domain does not accept email. Try another address." });
  });

  // The one thing to do next with this business.
  function nextStep() {
    if (!lead) return null;
    const st = lead.status;
    if (NO_EMAIL.includes(st)) {
      return (
        <div className={s.nextBox}>
          <b>Next: add an email address</b>
          <p>We could not find one on their website. Paste one you found (website contact page, LinkedIn, Google) and this business turns Ready.</p>
          <div className={s.row} style={{ marginTop: 0 }}>
            <input className={s.in} style={{ flex: "1 1 220px", maxWidth: 340 }} placeholder="name@business.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newEmail.trim()) addEmail(); }} aria-label="Add an email" />
            <button type="button" className="pm-btn primary" disabled={!newEmail.trim() || busy !== null} onClick={addEmail}><Plus /> {busy === "contact" ? "Checking…" : "Add email"}</button>
            <button type="button" className="pm-btn" onClick={() => setDialog("find")}><MailSearch /> Find more emails</button>
          </div>
        </div>
      );
    }
    if (st === "ready") {
      return (
        <div className={s.nextBox}>
          <b>Next: write the email</b>
          <p>The AI writes one email for this business from the PROMUNCH knowledge base. It waits here for you to read and approve.</p>
          <div className={s.row} style={{ marginTop: 0 }}>
            <button type="button" className="pm-btn primary" disabled={!!settings?.paused} onClick={() => setDialog("write")}><Sparkles /> Write the email</button>
            {settings?.paused ? <span className={s.hint}>Sending is paused in Settings.</span> : null}
          </div>
        </div>
      );
    }
    const copy: Record<string, [string, string]> = {
      drafting: ["The AI is writing the email", "It shows up below in a few seconds."],
      drafted: ["Next: read and approve the email", "It is below. Edit anything, then press Approve. Nothing sends before that."],
      approved: ["Approved, sending soon", `It goes out between ${settings?.send_window_start ?? 9}:00 and ${settings?.send_window_end ?? 18}:00 IST, inside the daily limit.`],
      contacted: ["Sent. Waiting for a reply", "If they reply it shows here and in Replies, and any follow-up stops."],
      replied: ["They replied", "Read it below and make it a deal if it is worth following up."],
    };
    const c = copy[st];
    return c ? <div className={s.nextBox}><b>{c[0]}</b><p>{c[1]}</p></div> : null;
  }

  const editable = live && ["draft", "failed"].includes(live.status);
  const edited = !!live && (subject !== live.subject || body !== live.body_text);
  const existingDeal = lead ? dealFor(lead) : null;
  const dealId = madeDeal !== undefined ? madeDeal : existingDeal?.id ?? null;
  const hasDeal = madeDeal !== undefined || !!existingDeal;

  return (
    <div className={s.drawerOverlay} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={lead ? `${lead.name} details` : "Business details"} className={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={s.dh}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className={s.eyebrow}>Business</span>
            <h2 className={s.who} style={{ fontSize: 25 }}>{lead?.name ?? "Loading…"}</h2>
            {lead ? (
              <>
                <p className={s.muted} style={{ margin: "8px 0 0", fontSize: 16 }}>
                  {[lead.category, lead.city].filter(Boolean).join(" · ")}
                  {lead.website ? <> · <a href={lead.website} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{lead.domain ?? "website"}</a></> : null}
                </p>
                <div className={s.tags} style={{ marginTop: 12 }}>
                  <StageTag status={lead.status} />
                  {lead.fit_score != null ? <Tag tone={lead.fit_score >= 70 ? "green" : lead.fit_score >= 50 ? "amber" : "grey"}>Fit {lead.fit_score}/100</Tag> : null}
                  {q.data?.followUp?.next_send_at ? <Tag tone="teal" dot>Follow-up {shortDate(q.data.followUp.next_send_at)}</Tag> : null}
                </div>
                {lead.fit_reason ? <p style={{ margin: "12px 0 0", fontSize: 16, lineHeight: 1.5, color: "var(--pm-ink2)" }}>{lead.fit_reason}</p> : null}
                {trackAt(lead.status) >= 0 ? (
                  <ol className={s.track} aria-label="Where this business is">
                    {TRACK.map((label, i) => {
                      const at = trackAt(lead.status);
                      const st = i < at || at === 6 ? "done" : i === at ? "now" : "todo";
                      return <li key={label} data-s={st} aria-current={st === "now" ? "step" : undefined}><i aria-hidden />{label}</li>;
                    })}
                  </ol>
                ) : null}
                {nextStep()}
              </>
            ) : null}
          </div>
          <button type="button" className="pm-btn ghost" onClick={onClose} aria-label="Close"><X /></button>
        </div>

        <div className={s.db}>
          {q.error ? <p className={s.errNote} style={{ marginTop: 20 }}>{(q.error as Error).message}</p> : null}
          {lead ? (
            <>
              {lead.outreach_replies?.length ? (
                <div className={s.dsec}>
                  <div className={s.secT}>
                    <h3>Their reply</h3>
                    {hasDeal ? (
                      <Link className={s.txtLink} href={dealId ? `/dashboard/deals?deal=${dealId}` : "/dashboard/deals"}>Open deal <ArrowRight /></Link>
                    ) : (
                      <button type="button" className="pm-btn primary" disabled={busy !== null} onClick={() => run("deal", async () => {
                        const id = await makeDeal(lead);
                        setMadeDeal(id);
                        qc.invalidateQueries({ queryKey: ["deals"] });
                        toast.push({ kind: "success", text: `${lead.name} is now a deal.` });
                      })}>
                        <Handshake /> {busy === "deal" ? "Making…" : "Make it a deal"}
                      </button>
                    )}
                  </div>
                  {[...lead.outreach_replies].sort((a, b) => +new Date(b.received_at) - +new Date(a.received_at)).map((r) => (
                    <div key={r.id} className={s.contact}>
                      <span>{r.from_name || r.from_email} · {shortDate(r.received_at)}</span>
                      <p className={s.quote}>{(r.body_text || r.subject || "").trim().slice(0, 2000)}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className={s.dsec}>
                <div className={s.secT}>
                  <h3>Email addresses</h3>
                  {lead.status === "ready" ? (
                    <button type="button" className={s.txtLink} onClick={() => setDialog("find")}><MailSearch /> Find more emails</button>
                  ) : null}
                </div>
                {(lead.lead_contacts ?? []).length ? (
                  [...lead.lead_contacts].sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).map((c) => (
                    <div key={c.id} className={s.contact}>
                      <b>{c.email}</b>
                      <span className={s.tags}>
                        {c.is_primary ? <Tag tone="blue" size="sm">Emails go here</Tag> : null}
                        {c.mailbox_status === "valid" ? <Tag tone="green" size="sm">Mailbox verified</Tag>
                          : c.verify_status === "mx_ok" ? <Tag tone="grey" size="sm">Domain accepts email</Tag>
                          : <Tag tone="red" size="sm">Not usable</Tag>}
                        {c.person_name ? <span>{c.person_name}{c.person_title ? `, ${c.person_title}` : ""}</span> : null}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className={s.muted} style={{ margin: 0 }}>No email found on their website yet.</p>
                )}
                {!NO_EMAIL.includes(lead.status) ? (
                  <div className={s.row}>
                    <input className={s.in} style={{ flex: "1 1 220px", maxWidth: 340 }} placeholder="Add another email you found" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} aria-label="Add an email" />
                    <button type="button" className="pm-btn" disabled={!newEmail.trim() || busy !== null} onClick={addEmail}>
                      <Plus /> Add
                    </button>
                  </div>
                ) : null}
              </div>

              <div className={s.dsec}>
                <h3>The email</h3>
                {live && editable ? (
                  <>
                    {live.error ? <p className={s.warnNote}>Last try: {live.error}</p> : null}
                    <div className={s.field}>
                      <label htmlFor="ld-subject">Subject</label>
                      <input id="ld-subject" className={s.in} value={subject} onChange={(e) => setSubject(e.target.value)} />
                    </div>
                    <div className={s.field}>
                      <label htmlFor="ld-body">Email {edited ? <span>· edited, saved when you approve</span> : null}</label>
                      <textarea id="ld-body" className={s.ta} value={body} onChange={(e) => setBody(e.target.value)} />
                    </div>
                    <div className={s.row}>
                      <button type="button" className="pm-btn primary" disabled={busy !== null || !!settings?.paused} onClick={() => run("approve", async () => {
                        if (edited) await api(`/api/leads/drafts/${live.id}`, { method: "PATCH", body: { subject, body_text: body } });
                        await api("/api/leads/approve", { body: { draft_ids: [live.id] } });
                        toast.push({ kind: "success", text: "Approved. It goes out soon." });
                      })}>
                        <Check /> {busy === "approve" ? "Approving…" : "Approve"}
                      </button>
                      <button type="button" className="pm-btn" disabled={busy !== null || !!settings?.paused} onClick={() => run("rewrite", async () => {
                        await api(`/api/leads/${lead.id}/draft`, { body: {} });
                        toast.push({ kind: "success", text: "Rewritten from the PROMUNCH knowledge base." });
                      })}>
                        <Sparkles /> {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
                      </button>
                      <button type="button" className="pm-btn ghost" disabled={busy !== null} onClick={() => run("skip", async () => {
                        await api(`/api/leads/drafts/${live.id}`, { method: "PATCH", body: { status: "discarded" } });
                        toast.push({ kind: "info", text: `${lead.name} will not be emailed.` });
                      })}>
                        <Trash2 /> Don&rsquo;t send
                      </button>
                    </div>
                  </>
                ) : live && live.status === "approved" ? (
                  <>
                    <div className={s.tags}><Tag tone="teal" dot>Approved, sending soon</Tag></div>
                    <p style={{ margin: 0, fontSize: 16, whiteSpace: "pre-wrap" }}><b>{live.subject}</b>{"\n\n"}{live.body_text}</p>
                    <div className={s.row}>
                      <button type="button" className="pm-btn ghost" disabled={busy !== null} onClick={() => run("skip", async () => {
                        await api(`/api/leads/drafts/${live.id}`, { method: "PATCH", body: { status: "discarded" } });
                        toast.push({ kind: "info", text: `Stopped. ${lead.name} will not be emailed.` });
                      })}>
                        <Trash2 /> Don&rsquo;t send
                      </button>
                    </div>
                  </>
                ) : live && live.status === "sending" ? (
                  <Tag tone="teal" dot>Sending now</Tag>
                ) : sent.length ? (
                  <>
                    <p className={s.muted} style={{ margin: 0 }}>Sent {shortDate(sent[sent.length - 1].sent_at)}{sent.length > 1 ? `, plus ${sent.length - 1} follow-up${sent.length > 2 ? "s" : ""}` : ""}.</p>
                    <p style={{ margin: 0, fontSize: 16, whiteSpace: "pre-wrap" }}><b>{sent[sent.length - 1].subject}</b>{"\n\n"}{sent[sent.length - 1].body_text}</p>
                  </>
                ) : lead.status === "ready" || lead.status === "drafting" ? (
                  <p className={s.muted} style={{ margin: 0 }}>{lead.status === "drafting" ? "Being written…" : "Not written yet. Press Write the email above."}</p>
                ) : (
                  <p className={s.muted} style={{ margin: 0 }}>
                    {["skipped", "suppressed"].includes(lead.status) ? "This business is marked not interested. It is never emailed." : "No email yet. It needs an email address first."}
                  </p>
                )}
              </div>

              {sent.length ? (
                <div className={s.dsec}>
                  <h3>History</h3>
                  <div className={s.hist}>
                    {[...sent.map((d) => ({ at: d.sent_at!, t: d.enrollment_id ? "Follow-up sent" : "Email sent", d: d.subject })),
                      ...(lead.outreach_replies ?? []).map((r) => ({ at: r.received_at, t: "Replied", d: r.subject ?? "" }))]
                      .sort((a, b) => +new Date(b.at) - +new Date(a.at))
                      .map((e, i) => (
                        <div key={i}><b>{e.t}</b>{e.d ? <span>{e.d}</span> : null}<time>{new Date(e.at).toLocaleString("en-IN")}</time></div>
                      ))}
                  </div>
                </div>
              ) : null}

              {!["suppressed"].includes(lead.status) ? (
                <div className={s.dsec}>
                  <div className={s.row}>
                    <button type="button" className="pm-btn ghost" onClick={() => setDialog("suppress")} disabled={busy !== null}>
                      <Ban /> Never contact this business
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {dialog === "find" && lead ? <FindEmailsDialog leadIds={[lead.id]} isAdmin={isAdmin} onClose={() => { setDialog(null); refresh(); }} /> : null}
      {dialog === "write" && lead ? (
        <WriteDialog leadIds={[lead.id]} listId={null} settings={settings} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />
      ) : null}
      {dialog === "suppress" && lead ? (
        <ConfirmDialog
          title="Never contact this business?"
          body="Its email addresses go on the do-not-email list and any email or follow-up waiting for it is cancelled."
          confirmLabel="Never contact"
          danger
          busy={busy === "suppress"}
          onConfirm={() => run("suppress", async () => {
            await api(`/api/leads/${lead.id}/suppress`, { body: {} });
            toast.push({ kind: "success", text: `${lead.name} will never be emailed.` });
            setDialog(null);
          })}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
