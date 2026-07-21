"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Send, Save, Clock } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PageHead, Panel } from "@/components/pm";

interface FormData {
  name: string;
  subject: string;
  preview: string;
  audience: string;
  body: string;
  scheduleAt: string; // datetime-local; empty = send now / draft only
}

type Mode = "draft" | "send" | "schedule";

const audiences = [
  { value: "all", label: "All subscribers" },
  { value: "vip", label: "VIP customers" },
  { value: "new", label: "New customers (last 30 days)" },
  { value: "lapsed", label: "Lapsed (90+ days)" },
];

export default function NewCampaignPage() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({ name: "", subject: "", preview: "", audience: "all", body: "", scheduleAt: "" });
  const update = (k: keyof FormData, v: string) => setFormData((p) => ({ ...p, [k]: v }));

  async function persist(mode: Mode) {
    if (!formData.name.trim() || !formData.subject.trim()) {
      toast.push({ kind: "error", text: "Name and subject are required." });
      return;
    }
    let scheduledAtIso: string | null = null;
    if (mode === "schedule") {
      if (!formData.scheduleAt) {
        toast.push({ kind: "error", text: "Pick a date and time to schedule." });
        return;
      }
      const when = new Date(formData.scheduleAt);
      if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        toast.push({ kind: "error", text: "Schedule time must be in the future." });
        return;
      }
      scheduledAtIso = when.toISOString();
    }
    setBusy(true);
    try {
      const payload = {
        name: formData.name,
        subject: formData.subject,
        preview_text: formData.preview,
        body_html: formData.body,
        segment_filter: { audience: formData.audience },
        status: mode === "schedule" ? "scheduled" : "draft",
        scheduled_at: scheduledAtIso,
      };
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.campaign) throw new Error(data.error || "Save failed");
      setSavedId(data.campaign.id);
      if (mode === "send") {
        const sendRes = await fetch(`/api/campaigns/${data.campaign.id}/send`, { method: "POST" });
        const sendData = await sendRes.json();
        if (!sendRes.ok) throw new Error(sendData.error || "Send failed");
        toast.push({ kind: "success", text: `Campaign sent to ${sendData.total_sent ?? 0} people.` });
      } else if (mode === "schedule") {
        toast.push({ kind: "success", text: "Campaign scheduled." });
      } else {
        toast.push({ kind: "success", text: "Draft saved." });
      }
      router.push(`/dashboard/campaigns/${data.campaign.id}`);
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  if (savedId) {
    return (
      <div className="pm-page">
        <div className="pm-panel" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", padding: 48 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--pm-green-soft)", display: "grid", placeItems: "center", margin: "0 auto 18px" }}>
            <CheckCircle2 size={28} color="var(--pm-green)" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Campaign saved</h2>
          <p className="pm-muted" style={{ fontSize: 13, marginBottom: 20 }}>&ldquo;{formData.name}&rdquo; — review and send when ready.</p>
          <Link href={`/dashboard/campaigns/${savedId}`} className="pm-btn primary" style={{ display: "inline-flex" }}>Open campaign</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page">
      <PageHead
        back={
          <Link href="/dashboard/campaigns" className="more" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--pm-muted)", fontSize: 12 }}>
            <ArrowLeft size={14} /> Back to campaigns
          </Link>
        }
        title="New campaign"
        subtitle="Compose a one-off email send."
        actions={
          <>
            <button className="pm-btn ghost" onClick={() => persist("draft")} disabled={busy}><Save size={15} /> Save draft</button>
            {formData.scheduleAt ? (
              <button className="pm-btn primary" onClick={() => persist("schedule")} disabled={busy}>
                <Clock size={15} /> {busy ? "Scheduling…" : "Schedule"}
              </button>
            ) : (
              <button className="pm-btn primary" onClick={() => { if (confirm("Send this campaign now?")) persist("send"); }} disabled={busy}>
                <Send size={15} /> {busy ? "Sending…" : "Save & send"}
              </button>
            )}
          </>
        }
      />

      <div style={{ maxWidth: 760 }}>
        <Panel title="Campaign info" style={{ marginBottom: 14 }}>
          <div className="pm-frow" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
            <div className="pm-field">
              <label>Campaign name</label>
              <input title="Campaign name" placeholder="Weekend sale — March" value={formData.name} onChange={(e) => update("name", e.target.value)} />
            </div>
            <div className="pm-field">
              <label>Audience</label>
              <select title="Audience" value={formData.audience} onChange={(e) => update("audience", e.target.value)}>
                {audiences.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
          </div>
          <div className="pm-field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Send time (optional)</label>
            <input type="datetime-local" title="Schedule send time" value={formData.scheduleAt} onChange={(e) => update("scheduleAt", e.target.value)} />
            <span className="pm-muted" style={{ fontSize: 11, marginTop: 4, display: "block" }}>Leave empty to send now. Set a future time to schedule the send; it fires within about 15 minutes of that time.</span>
          </div>
        </Panel>

        <Panel title="Subject line" caption="Shown in the inbox preview alongside the preview text." style={{ marginBottom: 14 }}>
          <div className="pm-field">
            <label>Subject</label>
            <input title="Subject" placeholder="Get 20% off this weekend only" value={formData.subject} onChange={(e) => update("subject", e.target.value)} />
          </div>
          <div className="pm-field" style={{ marginBottom: 0 }}>
            <label>Preview text</label>
            <input title="Preview text" placeholder="Use this 24 hours to grab your favourites" value={formData.preview} onChange={(e) => update("preview", e.target.value)} />
          </div>
        </Panel>

        <Panel title="Email body" caption="Plain HTML works. Paste or write your message below.">
          <div className="pm-field" style={{ marginBottom: 0 }}>
            <textarea
              title="Email body HTML"
              placeholder="<p>Hi {{first_name}}, …</p>"
              value={formData.body}
              onChange={(e) => update("body", e.target.value)}
              style={{ minHeight: 240, fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, resize: "vertical" }}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
