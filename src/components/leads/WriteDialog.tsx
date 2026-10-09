"use client";

// Step 3, Write: AI (from the PROMUNCH knowledge base) or a saved email, ONLY
// for the ticked businesses. Optional follow-ups for this batch. Nothing is
// sent until the emails are approved.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import s from "./b2b.module.css";
import Dialog from "./Dialog";
import { api, errText, plural, useB2bRefresh } from "./api";
import type { OutreachSettings, TemplateRow } from "./types";

type WriteResult = { batchId: string | null; written: number; skipped: number; failed: number; reasons: Record<string, number>; followUps: "on" | "off" | "unavailable" };

export function useSavedEmails() {
  return useQuery({
    queryKey: ["b2b", "saved-emails"],
    queryFn: async () => (await api<{ templates: TemplateRow[] }>("/api/leads/templates")).templates,
  });
}

export default function WriteDialog({
  leadIds, listId, settings, onClose, onDone,
}: {
  leadIds: string[];
  listId: string | null;
  settings: OutreachSettings | null;
  onClose: () => void;
  onDone: (batchId: string | null) => void;
}) {
  const toast = useToast();
  const refresh = useB2bRefresh();
  const saved = useSavedEmails();
  const [source, setSource] = useState<"ai" | "saved">("ai");
  const [templateId, setTemplateId] = useState("");
  const [followUp, setFollowUp] = useState(!!settings?.follow_up_default_on);
  const [count, setCount] = useState(Math.max(1, Math.min(2, settings?.follow_up_count ?? 1)));
  const [days, setDays] = useState(settings?.follow_up_days ?? 4);
  const [busy, setBusy] = useState(false);
  const n = leadIds.length;

  async function write() {
    setBusy(true);
    try {
      const r = await api<WriteResult>("/api/leads/write", {
        body: {
          lead_ids: leadIds,
          list_id: listId,
          template_id: source === "saved" ? templateId : null,
          follow_up_count: followUp ? count : 0,
          follow_up_days: days,
        },
      });
      const extra = Object.entries(r.reasons).map(([k, v]) => `${v} ${k}`).join(", ");
      toast.push({
        kind: r.written ? "success" : "info",
        text: `${plural(r.written, "email")} written and waiting for your approval.${extra ? ` Skipped: ${extra}.` : ""}${r.followUps === "unavailable" ? " Follow-ups need the latest database update." : ""}`,
      });
      refresh();
      onDone(r.batchId);
    } catch (e) {
      toast.push({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  const templates = saved.data ?? [];
  return (
    <Dialog title={`Write emails for ${plural(n, "business", "businesses")}`} onClose={onClose}>
      <p>Each email is written for that business. They wait in Approve for you to read. <b>Nothing is sent until you approve it.</b></p>

      <div className={s.opts} role="radiogroup" aria-label="Who writes the email">
        <button type="button" role="radio" aria-checked={source === "ai"} className={s.opt} data-on={source === "ai"} onClick={() => setSource("ai")}>
          <b>AI writes each one</b>
          <span>Personal to each business, using only facts from the PROMUNCH knowledge base.</span>
        </button>
        <button type="button" role="radio" aria-checked={source === "saved"} className={s.opt} data-on={source === "saved"} onClick={() => setSource("saved")}>
          <b>Use a saved email</b>
          <span>The same email for everyone, with the business name filled in.</span>
        </button>
      </div>

      {source === "saved" ? (
        <div className={s.field}>
          <label htmlFor="wd-saved">Saved email</label>
          {templates.length ? (
            <select id="wd-saved" className={s.sel} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Pick one…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : (
            <span className={s.hint}>{saved.isLoading ? "Loading…" : "No saved emails yet. Add one in Settings, or let the AI write them."}</span>
          )}
        </div>
      ) : null}

      <div className={s.field}>
        <label className={s.toggle}>
          <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
          <span>
            <b>Follow up if they don&rsquo;t reply</b>
            <span>A short, polite nudge. It stops by itself if they reply, bounce or ask not to be emailed.</span>
          </span>
        </label>
        {followUp ? (
          <div className={s.inline} style={{ paddingLeft: 34 }}>
            Send
            <select className={s.num} style={{ width: 150 }} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many follow-ups">
              <option value={1}>1 follow-up</option>
              <option value={2}>2 follow-ups</option>
            </select>
            every
            <input className={s.num} type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} aria-label="Days between emails" />
            days
          </div>
        ) : null}
      </div>

      {settings?.paused ? <p className={s.warnNote}>Sending is paused in Settings, so new emails are not written right now.</p> : null}

      <div className={s.dlgF}>
        <button type="button" className="pm-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="pm-btn primary" onClick={write} disabled={busy || !!settings?.paused || (source === "saved" && !templateId)}>
          <Sparkles /> {busy ? `Writing ${plural(n, "email")}…` : `Write ${plural(n, "email")}`}
        </button>
      </div>
    </Dialog>
  );
}
