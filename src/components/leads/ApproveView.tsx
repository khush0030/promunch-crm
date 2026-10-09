"use client";

// Step 4, Approve: the written emails, best fit first, one at a time.
//   Approve       = POST /api/leads/approve {draft_ids:[id]}  (queued; the
//                   server sends it paced inside the daily limit)
//   Approve all   = the same for every email in this view (after a confirm)
//   Don't send    = PATCH /api/leads/drafts/[id] {status:"discarded"}: ends
//                   that business for good, it is never written again
//   Rewrite       = POST /api/leads/[id]/draft (Master KB grounded)
// Edits are saved before approving.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Lock, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog, Tag } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import { api, errText, nf, plural, shortDate, useB2bRefresh } from "./api";
import type { ApproveDraft, BatchRow, OutreachSettings } from "./types";

export default function ApproveView({
  batchId, settings, onBatch, onOpenLead, onLists,
}: {
  batchId: string | null;
  settings: OutreachSettings | null;
  onBatch: (id: string | null) => void;
  onOpenLead: (leadId: string) => void;
  onLists: () => void;
}) {
  const toast = useToast();
  const refresh = useB2bRefresh();
  const q = useQuery({
    queryKey: ["b2b", "approve", batchId],
    queryFn: () => api<{ drafts: ApproveDraft[]; batches: BatchRow[] }>(`/api/leads/approve${batchId ? `?batch=${batchId}` : ""}`),
  });
  const [gone, setGone] = useState<Set<string>>(new Set());
  const queue = useMemo(() => (q.data?.drafts ?? []).filter((d) => !gone.has(d.id)), [q.data, gone]);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const draft = queue[Math.min(idx, Math.max(0, queue.length - 1))] ?? null;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    setSubject(draft?.subject ?? "");
    setBody(draft?.body_text ?? "");
  }, [draft?.id, draft?.subject, draft?.body_text]);

  const paused = !!settings?.paused;
  const batch = (q.data?.batches ?? []).find((b) => b.id === batchId) ?? null;
  const edited = !!draft && (subject !== draft.subject || body !== draft.body_text);

  function drop(id: string) {
    setGone((g) => new Set(g).add(id));
    setDone((d) => d + 1);
    refresh();
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  const saveEdits = async () => {
    if (!draft || !edited) return;
    await api(`/api/leads/drafts/${draft.id}`, { method: "PATCH", body: { subject, body_text: body } });
  };

  const approve = () =>
    run("approve", async () => {
      if (!draft) return;
      await saveEdits();
      await api("/api/leads/approve", { body: { draft_ids: [draft.id] } });
      toast.push({ kind: "success", text: `Approved. It goes to ${draft.leads.name} soon.` });
      drop(draft.id);
    });

  const approveAll = () =>
    run("all", async () => {
      if (draft && edited) await saveEdits();
      const ids = queue.map((d) => d.id);
      const r = await api<{ approved: number }>("/api/leads/approve", { body: { draft_ids: ids } });
      toast.push({ kind: "success", text: `${plural(r.approved, "email")} approved. They go out a few at a time inside your daily limit.` });
      setGone((g) => new Set([...g, ...ids]));
      setDone((d) => d + ids.length);
      setConfirmAll(false);
      refresh();
    });

  const dontSend = () =>
    run("skip", async () => {
      if (!draft) return;
      await api(`/api/leads/drafts/${draft.id}`, { method: "PATCH", body: { status: "discarded" } });
      toast.push({ kind: "info", text: `${draft.leads.name} will not be emailed.` });
      drop(draft.id);
    });

  const rewrite = () =>
    run("rewrite", async () => {
      if (!draft) return;
      await api(`/api/leads/${draft.lead_id}/draft`, { body: {} });
      toast.push({ kind: "success", text: "Rewritten from the PROMUNCH knowledge base." });
      await q.refetch();
    });

  const batches = q.data?.batches ?? [];

  return (
    <div className={s.body}>
      {batches.length ? (
        <div className={s.chips} role="tablist" aria-label="Which emails">
          <button type="button" role="tab" aria-selected={!batchId} className={s.chip} data-on={!batchId} onClick={() => onBatch(null)}>All waiting</button>
          {batches.slice(0, 6).map((b) => (
            <button key={b.id} type="button" role="tab" aria-selected={batchId === b.id} className={s.chip} data-on={batchId === b.id} onClick={() => onBatch(b.id)}>
              {b.lead_lists?.name ? `${b.lead_lists.name.replace(/\s+[—–]\s+/g, " · ")}, ` : "Written "}{shortDate(b.created_at)}
            </button>
          ))}
        </div>
      ) : null}

      {paused ? <p className={s.warnNote}>Sending is paused in Settings. You can read and edit, but approving is off until sending is back on.</p> : null}

      {q.isLoading ? (
        <section className={s.card}><p className={s.muted}>Loading emails…</p></section>
      ) : q.error ? (
        <section className={s.card}><p className={s.errNote}>Could not load: {(q.error as Error).message}</p></section>
      ) : !draft ? (
        <section className={s.card}>
          <div className={s.empty}>
            <b>{done > 0 ? `All done. ${plural(done, "email")} handled.` : "Nothing waiting for approval"}</b>
            <p>Open a list, tick the businesses you want to email and press Write emails. They land here for you to read.</p>
            <button type="button" className="pm-btn primary" onClick={onLists}>Open lists</button>
          </div>
        </section>
      ) : (
        <>
          <div>
            <div className={s.row} style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 16, color: "var(--pm-ink2)" }}>
                Email <b>{nf(Math.min(idx, queue.length - 1) + 1)}</b> of {nf(queue.length)} waiting
                {done ? <> · <b>{nf(done)}</b> handled</> : null}
                {batch?.follow_up_count ? <> · follow-ups on ({batch.follow_up_count}, every {batch.follow_up_days} days)</> : null}
              </span>
              <button type="button" className="pm-btn" onClick={() => setConfirmAll(true)} disabled={busy !== null || paused}>
                <Check /> Approve all {nf(queue.length)}
              </button>
            </div>
            <div className={s.bar} aria-hidden><i style={{ width: `${Math.max(2, Math.round((done / (done + queue.length)) * 100))}%` }} /></div>
          </div>

          <div className={s.review}>
            <section className={s.card}>
              <span className={s.eyebrow}>To</span>
              <h2 className={s.who}>{draft.leads.name}</h2>
              <p className={s.muted} style={{ margin: "8px 0 0", fontSize: 16 }}>
                {[draft.leads.category, draft.leads.city].filter(Boolean).join(" · ")}
                {draft.leads.website ? <> · <a href={draft.leads.website} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{draft.leads.domain ?? "website"}</a></> : null}
              </p>
              <dl className={s.kv}>
                <dt>Email</dt>
                <dd>
                  {draft.lead_contacts?.email ?? "None"}
                  {draft.lead_contacts?.person_name ? <span className={s.muted}> · {draft.lead_contacts.person_name}{draft.lead_contacts.person_title ? `, ${draft.lead_contacts.person_title}` : ""}</span> : null}
                </dd>
                <dt>Checked</dt>
                <dd>
                  {draft.lead_contacts?.mailbox_status === "valid" ? <Tag tone="green" dot>Mailbox verified</Tag>
                    : draft.lead_contacts?.verify_status === "mx_ok" ? <Tag tone="blue" dot>Domain accepts email</Tag>
                    : <Tag tone="amber" dot>Not checked</Tag>}
                </dd>
                <dt>Fit</dt>
                <dd>
                  {draft.leads.fit_score != null ? (
                    <Tag tone={draft.leads.fit_score >= 70 ? "green" : draft.leads.fit_score >= 50 ? "amber" : "grey"}>
                      {draft.leads.fit_score >= 70 ? "Good fit" : draft.leads.fit_score >= 50 ? "Maybe" : "Weak fit"} · {draft.leads.fit_score}/100
                    </Tag>
                  ) : "Not scored"}
                  {draft.leads.fit_reason ? <div className={s.muted} style={{ fontSize: 15.5, marginTop: 6 }}>{draft.leads.fit_reason}</div> : null}
                </dd>
              </dl>
              {draft.leads.enrichment?.summary || draft.leads.enrichment?.fitAngle ? (
                <div className={s.intel}>
                  {draft.leads.enrichment.summary ? <p>{draft.leads.enrichment.summary}</p> : null}
                  {draft.leads.enrichment.fitAngle ? <p><b>Best angle:</b> {draft.leads.enrichment.fitAngle}</p> : null}
                </div>
              ) : null}
              <button type="button" className={s.txtLink} style={{ marginTop: 18 }} onClick={() => onOpenLead(draft.lead_id)}>
                Everything about this business <ArrowRight />
              </button>
            </section>

            <section className={s.card}>
              {draft.error ? <p className={s.warnNote} style={{ marginBottom: 14 }}>Last try: {draft.error}</p> : null}
              <div className={s.field}>
                <label htmlFor="ap-subject">Subject</label>
                <input id="ap-subject" className={s.in} value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className={s.field}>
                <label htmlFor="ap-body">Email {edited ? <span>· edited, saved when you approve</span> : null}</label>
                <textarea id="ap-body" className={s.ta} value={body} onChange={(e) => setBody(e.target.value)} />
                <span className={s.hint}>From {settings?.from_name ?? "Parth from PROMUNCH"} &lt;{settings?.from_email ?? "parth@trypromunch.in"}&gt;.</span>
              </div>
              <div className={s.row} style={{ marginTop: 22 }}>
                <button type="button" className="pm-btn ghost" onClick={() => setIdx((i) => (i + 1) % queue.length)} disabled={busy !== null || queue.length < 2}>Later</button>
                <button type="button" className="pm-btn ghost" onClick={dontSend} disabled={busy !== null}>
                  <Trash2 /> {busy === "skip" ? "Saving…" : "Don’t send"}
                </button>
                <button type="button" className="pm-btn" onClick={rewrite} disabled={busy !== null || paused}>
                  <Sparkles /> {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
                </button>
                <span className={s.sp} />
                <button type="button" className="pm-btn primary" onClick={approve} disabled={busy !== null || paused || !subject.trim() || !body.trim()}>
                  <Check /> {busy === "approve" ? "Approving…" : "Approve, next"}
                </button>
              </div>
            </section>
          </div>

          <div className={s.note}>
            <Lock />
            <div>
              Approved emails go out a few at a time between {settings?.send_window_start ?? 9}:00 and {settings?.send_window_end ?? 18}:00 IST,
              never more than {settings?.daily_cap ?? 15} a day. A business is never emailed twice. &ldquo;Don&rsquo;t send&rdquo; ends that business for good.
            </div>
          </div>
        </>
      )}

      {confirmAll ? (
        <ConfirmDialog
          title={`Approve all ${nf(queue.length)} emails?`}
          body={`They go out a few at a time, at most ${settings?.daily_cap ?? 15} a day. Make sure you have read them.`}
          confirmLabel="Approve all"
          busy={busy === "all"}
          onConfirm={approveAll}
          onClose={() => setConfirmAll(false)}
        />
      ) : null}
    </div>
  );
}
