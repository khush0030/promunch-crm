"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, CheckCircle2, Send, Save } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface FormData {
  name: string;
  subject: string;
  preview: string;
  audience: string;
  body: string;
}

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
  const [formData, setFormData] = useState<FormData>({
    name: "",
    subject: "",
    preview: "",
    audience: "all",
    body: "",
  });
  const update = (k: keyof FormData, v: string) => setFormData((p) => ({ ...p, [k]: v }));

  async function persist(send: boolean) {
    if (!formData.name.trim() || !formData.subject.trim()) {
      toast.push({ kind: "error", text: "Name and subject are required." });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: formData.name,
        subject: formData.subject,
        preview_text: formData.preview,
        body_html: formData.body,
        segment_filter: { audience: formData.audience },
        status: "draft",
      };
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.campaign) throw new Error(data.error || "Save failed");
      setSavedId(data.campaign.id);
      toast.push({ kind: "success", text: "Draft saved." });
      if (send) {
        const sendRes = await fetch(`/api/campaigns/${data.campaign.id}/send`, { method: "POST" });
        const sendData = await sendRes.json();
        if (!sendRes.ok) throw new Error(sendData.error || "Send failed");
        toast.push({ kind: "success", text: "Campaign sent." });
        router.push(`/dashboard/campaigns/${data.campaign.id}`);
      } else {
        router.push(`/dashboard/campaigns/${data.campaign.id}`);
      }
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  if (savedId) {
    return (
      <div className="page" style={{ maxWidth: 640 }}>
        <div className="card card-pad" style={{ textAlign: "center", padding: 48 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "var(--green-soft)",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 18px",
            }}
          >
            <CheckCircle2 size={28} color="var(--green)" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Campaign saved</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
            &ldquo;{formData.name}&rdquo; — review and send when ready.
          </p>
          <Link href={`/dashboard/campaigns/${savedId}`} className="btn primary">
            Open campaign
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <Link
        href="/dashboard/campaigns"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-2)",
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        <ChevronLeft size={14} /> Back to Campaigns
      </Link>

      <div className="page-head">
        <div>
          <h1>New campaign</h1>
          <div className="sub">Compose a one-off email send.</div>
        </div>
      </div>

      <div className="card card-pad section">
        <div className="card-title">Campaign info</div>
        <div className="grid-2" style={{ marginTop: 14 }}>
          <div className="field">
            <label>Campaign name</label>
            <input
              className="input"
              title="Campaign name"
              placeholder="Weekend sale — March"
              value={formData.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Audience</label>
            <select
              className="input"
              title="Audience"
              value={formData.audience}
              onChange={(e) => update("audience", e.target.value)}
            >
              {audiences.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card card-pad section">
        <div className="card-title">Subject line</div>
        <div className="card-sub">Shown in the inbox preview alongside the preview text.</div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field">
            <label>Subject</label>
            <input
              className="input"
              title="Subject"
              placeholder="Get 20% off this weekend only"
              value={formData.subject}
              onChange={(e) => update("subject", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Preview text</label>
            <input
              className="input"
              title="Preview text"
              placeholder="Use this 24 hours to grab your favourites"
              value={formData.preview}
              onChange={(e) => update("preview", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card card-pad section">
        <div className="card-title">Email body</div>
        <div className="card-sub">Plain HTML works. Paste or write your message below.</div>
        <textarea
          className="input"
          title="Email body HTML"
          placeholder="<p>Hi {{first_name}}, …</p>"
          value={formData.body}
          onChange={(e) => update("body", e.target.value)}
          style={{ marginTop: 14, minHeight: 240, fontFamily: "var(--font-geist-mono), monospace", fontSize: 13 }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          className="btn"
          onClick={() => persist(false)}
          disabled={busy}
        >
          <Save size={14} /> Save draft
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            if (confirm("Send this campaign now?")) persist(true);
          }}
          disabled={busy}
        >
          <Send size={14} /> {busy ? "Sending…" : "Save & send"}
        </button>
      </div>
    </div>
  );
}
