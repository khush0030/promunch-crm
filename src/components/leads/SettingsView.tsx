"use client";

// Settings: sending (pause, daily limit), sender, follow-up defaults, saved
// emails, and (admin) the paid email finder. Rarely changed.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Tag } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import Dialog from "./Dialog";
import { api, errText, nf, useB2bRefresh } from "./api";
import { useSavedEmails } from "./WriteDialog";
import type { OutreachSettings, TemplateRow } from "./types";

export default function SettingsView({ settings, sentToday, isAdmin }: { settings: OutreachSettings | null; sentToday: number; isAdmin: boolean }) {
  if (!settings) return <div className={s.body}><p className={s.muted}>Loading settings…</p></div>;
  return (
    <div className={s.body}>
      <div className={s.setGrid}>
        <SendingCard settings={settings} sentToday={sentToday} />
        <FollowUpCard settings={settings} />
      </div>
      <SavedEmailsCard />
      {isAdmin ? <FinderCard /> : null}
    </div>
  );
}

function SendingCard({ settings, sentToday }: { settings: OutreachSettings; sentToday: number }) {
  const toast = useToast();
  const refresh = useB2bRefresh();
  const [form, setForm] = useState({
    daily_cap: settings.daily_cap,
    from_name: settings.from_name,
    reply_to: settings.reply_to ?? "",
    footer_address: settings.footer_address,
  });
  const [busy, setBusy] = useState(false);

  async function save(patch: Record<string, unknown>, msg: string) {
    setBusy(true);
    try {
      await api("/api/leads/settings", { method: "PATCH", body: patch });
      toast.push({ kind: "success", text: msg });
      refresh();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.card}>
      <div className={s.secT}>
        <h3>Sending</h3>
        {settings.paused ? <Tag tone="amber" dot>Sending paused</Tag> : <Tag tone="green" dot>Sending on</Tag>}
      </div>
      <p className={s.lede}>{nf(sentToday)} of {nf(settings.daily_cap)} sent today. Emails go out between {settings.send_window_start ?? 9}:00 and {settings.send_window_end ?? 18}:00 IST.</p>
      <div className={s.row} style={{ margin: "18px 0 24px" }}>
        <button type="button" className={settings.paused ? "pm-btn primary" : "pm-btn"} disabled={busy} onClick={() => save({ paused: !settings.paused }, settings.paused ? "Sending is back on." : "Sending paused. Nothing is written or sent.")}>
          {settings.paused ? "Turn sending back on" : "Pause sending"}
        </button>
        <span className={s.hint}>Pausing also stops writing and approving new emails.</span>
      </div>

      <div className={s.field}>
        <label htmlFor="st-cap">Daily limit <span>(start low; raise it weekly, e.g. 15, 30, 50)</span></label>
        <input id="st-cap" className={s.num} style={{ width: 120 }} type="number" min={0} max={500} value={form.daily_cap} onChange={(e) => setForm({ ...form, daily_cap: parseInt(e.target.value || "0", 10) })} />
      </div>
      <div className={s.field}>
        <label htmlFor="st-name">From name</label>
        <input id="st-name" className={s.in} value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
      </div>
      <div className={s.field}>
        <label htmlFor="st-email">From address <span>(fixed: Parth, founder)</span></label>
        <input id="st-email" className={s.in} value={settings.from_email} disabled />
      </div>
      <div className={s.field}>
        <label htmlFor="st-reply">Replies go to <span>(empty = the from address)</span></label>
        <input id="st-reply" className={s.in} value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} />
      </div>
      <div className={s.field}>
        <label htmlFor="st-foot">Address line under every email</label>
        <input id="st-foot" className={s.in} value={form.footer_address} onChange={(e) => setForm({ ...form, footer_address: e.target.value })} />
      </div>
      <div className={s.row} style={{ marginTop: 22 }}>
        <button type="button" className="pm-btn primary" disabled={busy} onClick={() => save(form, "Settings saved.")}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </section>
  );
}

function FollowUpCard({ settings }: { settings: OutreachSettings }) {
  const toast = useToast();
  const refresh = useB2bRefresh();
  const [on, setOn] = useState(!!settings.follow_up_default_on);
  const [count, setCount] = useState(Math.max(1, settings.follow_up_count ?? 1));
  const [days, setDays] = useState(settings.follow_up_days ?? 4);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api("/api/leads/settings", { method: "PATCH", body: { follow_up_default_on: on, follow_up_count: count, follow_up_days: days } });
      toast.push({ kind: "success", text: "Follow-up defaults saved." });
      refresh();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.card}>
      <div className={s.secT}><h3>Follow-ups</h3></div>
      <p className={s.lede}>
        When you write emails you can tick &ldquo;Follow up if they don&rsquo;t reply&rdquo;. These are the defaults for that tick box.
        A follow-up never goes to a business that replied, bounced or asked not to be emailed.
      </p>
      <div className={s.field} style={{ marginTop: 20 }}>
        <label className={s.toggle}>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span><b>Tick it by default</b></span>
        </label>
      </div>
      <div className={s.field}>
        <span className={s.fieldL}>How many</span>
        <div className={s.inline}>
          <select className={s.num} style={{ width: 150 }} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many follow-ups">
            <option value={1}>1 follow-up</option>
            <option value={2}>2 follow-ups</option>
          </select>
          every
          <input className={s.num} type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} aria-label="Days between emails" />
          days
        </div>
      </div>
      <div className={s.row} style={{ marginTop: 22 }}>
        <button type="button" className="pm-btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </section>
  );
}

type Editor = { id: string | null; name: string; subject: string; body_text: string };

function SavedEmailsCard() {
  const toast = useToast();
  const q = useSavedEmails();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editor) return;
    setBusy(true);
    try {
      await api(editor.id ? `/api/leads/templates/${editor.id}` : "/api/leads/templates", {
        method: editor.id ? "PATCH" : "POST",
        body: { name: editor.name, subject: editor.subject, body_text: editor.body_text },
      });
      toast.push({ kind: "success", text: "Saved email stored." });
      setEditor(null);
      q.refetch();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: TemplateRow) {
    setBusy(true);
    try {
      await api(`/api/leads/templates/${t.id}`, { method: "DELETE" });
      toast.push({ kind: "success", text: "Saved email removed." });
      setEditor(null);
      q.refetch();
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  const rows = q.data ?? [];
  return (
    <section className={s.card}>
      <div className={s.secT}>
        <h3>Saved emails</h3>
        <button type="button" className="pm-btn" onClick={() => setEditor({ id: null, name: "", subject: "", body_text: "" })}><Plus /> New saved email</button>
      </div>
      <p className={s.lede}>Use one instead of the AI when you write emails. {"{company}"} and {"{city}"} are filled in for each business.</p>
      {q.isLoading ? <p className={s.muted}>Loading…</p> : rows.length === 0 ? (
        <p className={s.muted} style={{ marginTop: 14 }}>No saved emails yet.</p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {rows.map((t) => (
            <div key={t.id} className={s.tplRow}>
              <div>
                <b>{t.name}</b>
                <span>{t.subject}</span>
              </div>
              <button type="button" className={s.txtLink} onClick={() => setEditor({ id: t.id, name: t.name, subject: t.subject, body_text: t.body_text })}>Edit</button>
            </div>
          ))}
        </div>
      )}
      {editor ? (
        <Dialog title={editor.id ? "Edit saved email" : "New saved email"} onClose={() => setEditor(null)}>
          <div>
            <div className={s.field}>
              <label htmlFor="se-name">Name <span>(only you see this)</span></label>
              <input id="se-name" className={s.in} value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="Gifting intro" />
            </div>
            <div className={s.field}>
              <label htmlFor="se-subject">Subject</label>
              <input id="se-subject" className={s.in} value={editor.subject} onChange={(e) => setEditor({ ...editor, subject: e.target.value })} placeholder="PROMUNCH snacks for {company}" />
            </div>
            <div className={s.field}>
              <label htmlFor="se-body">Email</label>
              <textarea id="se-body" className={s.ta} value={editor.body_text} onChange={(e) => setEditor({ ...editor, body_text: e.target.value })} />
              <span className={s.hint}>Write PROMUNCH in capitals, sign off as Parth, and only state product facts from the knowledge base.</span>
            </div>
          </div>
          <div className={s.dlgF}>
            {editor.id ? (
              <button type="button" className="pm-btn ghost" disabled={busy} onClick={() => { const t = rows.find((x) => x.id === editor.id); if (t) remove(t); }}>
                <Trash2 /> Remove
              </button>
            ) : null}
            <span className={s.sp} />
            <button type="button" className="pm-btn ghost" onClick={() => setEditor(null)} disabled={busy}>Cancel</button>
            <button type="button" className="pm-btn primary" onClick={save} disabled={busy || !editor.name.trim() || !editor.subject.trim() || !editor.body_text.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

type Provider = { provider: string; enabled: boolean; monthly_credit_cap: number; used_this_month: number };

function FinderCard() {
  const toast = useToast();
  const [rows, setRows] = useState<Provider[] | null>(null);
  useEffect(() => {
    api<{ providers: Provider[] }>("/api/leads/buyers/providers").then((j) => setRows(j.providers)).catch(() => setRows([]));
  }, []);

  async function save(p: Provider) {
    try {
      await api("/api/leads/buyers/providers", { method: "PATCH", body: { provider: p.provider, enabled: p.enabled, monthly_credit_cap: p.monthly_credit_cap } });
      toast.push({ kind: "success", text: "Paid finder saved." });
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    }
  }

  return (
    <section className={s.card}>
      <div className={s.secT}><h3>Paid email finder</h3><Tag tone="grey">Admin only</Tag></div>
      <p className={s.lede}>Looks up a named person when a website lists no email. Pay as you go, capped per month. Only the owner can change this; the key goes in Settings, API keys.</p>
      {rows === null ? <p className={s.muted}>Loading…</p> : rows.length === 0 ? <p className={s.muted}>No finder set up.</p> : (
        <div style={{ marginTop: 8 }}>
          {rows.map((p) => (
            <div key={p.provider} className={s.tplRow} style={{ alignItems: "center" }}>
              <div>
                <label className={s.toggle}>
                  <input type="checkbox" checked={p.enabled} onChange={(e) => setRows((rs) => rs!.map((r) => (r.provider === p.provider ? { ...r, enabled: e.target.checked } : r)))} />
                  <span><b style={{ textTransform: "capitalize" }}>{p.provider}</b><span>{nf(p.used_this_month)} credits used this month</span></span>
                </label>
              </div>
              <div className={s.inline} style={{ flex: "none", flexDirection: "row" }}>
                <input className={s.num} type="number" min={0} max={100000} value={p.monthly_credit_cap} aria-label={`${p.provider} monthly credits`}
                  onChange={(e) => setRows((rs) => rs!.map((r) => (r.provider === p.provider ? { ...r, monthly_credit_cap: parseInt(e.target.value || "0", 10) } : r)))} />
                a month
                <button type="button" className="pm-btn" onClick={() => save(p)}>Save</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
