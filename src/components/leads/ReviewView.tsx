"use client";

// B2B · Review (prototype b2b-review): the AI-written emails, one at a time,
// best fit first. Every action is the same call the lead drawer makes:
//   Send     = PATCH /api/leads/drafts/[id] (only if edited) then
//              POST  /api/leads/drafts/[id]/send  (atomic claim, daily cap,
//              suppression check, pause check all live server-side)
//   Rewrite  = POST  /api/leads/[id]/draft  {}
//   Discard  = PATCH /api/leads/drafts/[id] {status:"discarded"}
//   Skip     = local only, moves to the next email.
// One click sends one email. There is no batch send.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Lock, Send, Sparkles, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import type { Lead, OutreachSettings } from "./types";
import { nf } from "./stages";

const PAGE = 50;

export default function ReviewView({
  settings, sentToday, onChanged, onOpenLead, onFind, onRun, running, writing,
}: {
  settings: OutreachSettings | null;
  sentToday: number;
  onChanged: () => void;
  onOpenLead: (lead: Lead) => void;
  onFind: () => void;
  onRun: () => void;
  running: boolean;
  writing: number;
}) {
  const toast = useToast();
  const [queue, setQueue] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");

  const load = useCallback(async (keepId?: string) => {
    try {
      const res = await fetch(`/api/leads?status=drafted&limit=${PAGE}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "load failed");
      const leads = (json.leads ?? []) as Lead[];
      setQueue(leads);
      setTotal(json.total ?? leads.length);
      if (keepId) {
        const i = leads.findIndex((l) => l.id === keepId);
        setIdx(i >= 0 ? i : 0);
      }
    } catch (e) {
      toast.push({ kind: "error", text: `Could not load emails to review: ${e instanceof Error ? e.message : "unknown"}` });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const lead = queue[Math.min(idx, Math.max(0, queue.length - 1))] ?? null;
  const draft = useMemo(
    () => (lead?.outreach_drafts ?? []).find((d) => ["draft", "approved", "failed"].includes(d.status)) ?? null,
    [lead],
  );
  const contact = lead?.lead_contacts.find((c) => c.id === draft?.contact_id) ?? null;

  useEffect(() => {
    setSubject(draft?.subject ?? "");
    setBodyText(draft?.body_text ?? "");
  }, [draft?.id, draft?.subject, draft?.body_text]);

  const sender = settings?.from_name?.split(" ")[0] || "Parth";
  const cap = settings?.daily_cap ?? null;
  const capHit = cap != null && sentToday >= cap;
  const paused = !!settings?.paused;

  function removeCurrent() {
    if (!lead) return;
    setQueue((q) => q.filter((l) => l.id !== lead.id));
    setTotal((t) => Math.max(0, t - 1));
    setDone((d) => d + 1);
    setIdx((i) => (i >= queue.length - 1 ? 0 : i));
    onChanged();
  }

  async function call(label: string, url: string, init?: RequestInit): Promise<boolean> {
    setBusy(label);
    try {
      const res = await fetch(url, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `${label} failed`);
      return true;
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : `${label} failed` });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!lead || !draft) return;
    if (subject !== draft.subject || bodyText !== draft.body_text) {
      const saved = await call("save", `/api/leads/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, body_text: bodyText }),
      });
      if (!saved) return;
    }
    if (await call("send", `/api/leads/drafts/${draft.id}/send`, { method: "POST" })) {
      toast.push({ kind: "success", text: `Sent to ${contact?.email ?? lead.name} as ${sender}.` });
      removeCurrent();
    } else {
      load(lead.id);
    }
  }

  async function discard() {
    if (!lead || !draft) return;
    if (await call("discard", `/api/leads/drafts/${draft.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "discarded" }),
    })) {
      toast.push({ kind: "info", text: `Discarded the email to ${lead.name}. It will not be sent.` });
      removeCurrent();
    }
  }

  async function rewrite() {
    if (!lead) return;
    if (await call("rewrite", `/api/leads/${lead.id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })) {
      toast.push({ kind: "success", text: "Rewritten from the knowledge base." });
      await load(lead.id);
    }
  }

  function skip() {
    if (queue.length > 1) setIdx((i) => (i + 1) % queue.length);
  }

  if (loading) return <div className={s.body}><div className={s.card}><p className={s.muted}>Loading emails…</p></div></div>;

  if (!lead || !draft) {
    return (
      <div className={s.body}>
        <section className={s.card}>
          <div className={s.empty}>
            <b>{done > 0 ? `All done. ${nf(done)} handled this session.` : "Nothing to review"}</b>
            <p>
              {writing > 0
                ? `${nf(writing)} businesses have a work email and are waiting for the AI to write their email. Run the next batch and they land here.`
                : "When new businesses are found, the AI writes an email for each from the knowledge base and it lands here for you to read."}
            </p>
            {writing > 0 ? (
              <button type="button" className="pm-btn primary" onClick={onRun} disabled={running}>
                {running ? "Working…" : "Run next batch"}
              </button>
            ) : (
              <button type="button" className="pm-btn primary" onClick={onFind}>Find businesses</button>
            )}
          </div>
        </section>
      </div>
    );
  }

  const position = Math.min(idx, queue.length - 1) + 1;
  const pct = total + done > 0 ? Math.round((done / (total + done)) * 100) : 0;
  const edited = subject !== draft.subject || bodyText !== draft.body_text;
  const mailboxOk = contact?.mailbox_status === "valid";
  const mxOk = contact?.verify_status === "mx_ok";

  return (
    <div className={s.body}>
      <div>
        <div className={s.row} style={{ marginBottom: 10, justifyContent: "space-between" }}>
          <span className={s.small} style={{ color: "var(--pm-ink2)" }}>
            Email <b>{nf(position)}</b> of {nf(total)} waiting
            {done > 0 ? <> · <b>{nf(done)}</b> handled</> : null}
          </span>
          <span className={s.small} style={{ color: "var(--pm-ink2)" }}>
            Sent today <b>{nf(sentToday)}</b>{cap != null ? ` of ${cap}` : ""}
          </span>
        </div>
        <div className={s.bar} aria-hidden><i style={{ width: `${Math.max(2, pct)}%` }} /></div>
        {paused ? <p className={s.warnNote} style={{ margin: "10px 0 0" }}>Outreach is paused in Setup, so Send will be refused until it is turned back on.</p> : null}
        {!paused && capHit ? <p className={s.warnNote} style={{ margin: "10px 0 0" }}>Today&rsquo;s limit of {cap} is reached. Sends are refused until tomorrow; you can still read, edit and skip.</p> : null}
      </div>

      <div className={s.review}>
        <section className={s.card}>
          <span className={s.eyebrow}>To</span>
          <h2 className={s.who}>{lead.name}</h2>
          <p className={s.muted} style={{ margin: "6px 0 0", fontSize: 15 }}>
            {[lead.category, lead.city].filter(Boolean).join(" · ") || "No category"}
            {lead.website ? <> · <a href={lead.website} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{lead.domain ?? "website"}</a></> : null}
          </p>
          <dl className={s.kv}>
            <dt>Email</dt>
            <dd>
              {contact?.email ?? "–"}
              {contact?.person_name ? <span className={s.muted}> · {contact.person_name}{contact.person_title ? `, ${contact.person_title}` : ""}</span> : null}
            </dd>
            <dt>Email check</dt>
            <dd>
              <span className={s.tg} data-tone={mailboxOk || mxOk ? "good" : "warn"}>
                {mailboxOk ? "Mailbox verified" : mxOk ? "Mail server OK" : "Not verified"}
              </span>
            </dd>
            <dt>Fit</dt>
            <dd>
              {lead.fit_score != null ? (
                <span className={s.tg} data-tone={lead.fit_score >= 70 ? "good" : lead.fit_score >= 50 ? "warn" : "bad"}>
                  {lead.fit_score >= 70 ? "Good fit" : lead.fit_score >= 50 ? "Maybe" : "Weak fit"} · {lead.fit_score}/100
                </span>
              ) : "Not scored"}
              {lead.fit_reason ? <div className={s.muted} style={{ fontSize: 14, marginTop: 4 }}>{lead.fit_reason}</div> : null}
            </dd>
            {lead.products?.length ? (<><dt>Pitching</dt><dd>{lead.products.join(", ")}</dd></>) : null}
          </dl>
          {lead.enrichment?.summary || lead.enrichment?.fitAngle ? (
            <div className={s.intel}>
              {lead.enrichment.summary ? <p>{lead.enrichment.summary}</p> : null}
              {lead.enrichment.fitAngle ? <p><b>Best angle:</b> {lead.enrichment.fitAngle}</p> : null}
            </div>
          ) : null}
          <button type="button" className={s.txtLink} style={{ marginTop: 16 }} onClick={() => onOpenLead(lead)}>
            Full details, other contacts, decision maker <ArrowRight />
          </button>
        </section>

        <section className={s.card}>
          {draft.error ? <p className={s.warnNote} style={{ margin: "0 0 12px" }}>Last attempt: {draft.error}</p> : null}
          <div className={s.field}>
            <label htmlFor="rv-subject">Subject</label>
            <input id="rv-subject" className={s.in} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className={s.field}>
            <label htmlFor="rv-body">Email {edited ? <span>· edited, your changes are saved when you send</span> : null}</label>
            <textarea id="rv-body" className={s.ta} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
            <span className={s.hint}>Written by AI from the PROMUNCH knowledge base. From {settings?.from_name ?? sender} &lt;{settings?.from_email ?? "parth@trypromunch.in"}&gt;.</span>
          </div>
          <div className={s.row} style={{ marginTop: 18 }}>
            <button type="button" className="pm-btn ghost" onClick={skip} disabled={busy !== null || queue.length < 2}>Skip</button>
            <button type="button" className="pm-btn ghost" onClick={discard} disabled={busy !== null}>
              <Trash2 /> {busy === "discard" ? "Discarding…" : "Don’t send"}
            </button>
            <button type="button" className="pm-btn" onClick={rewrite} disabled={busy !== null}>
              <Sparkles /> {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
            </button>
            <span className={s.sp} />
            <button type="button" className="pm-btn primary" onClick={send} disabled={busy !== null || !subject.trim() || !bodyText.trim()}>
              <Send /> {busy === "send" || busy === "save" ? "Sending…" : `Send as ${sender}, next`}
            </button>
          </div>
        </section>
      </div>

      <div className={s.note}>
        <Lock />
        <div>
          Nothing sends until you press Send, and each press sends one email. Bounced and blocked addresses are refused
          automatically, and a reply stops any follow-ups. Follow-ups only run for lists you put into a follow-up campaign.
        </div>
      </div>
    </div>
  );
}
