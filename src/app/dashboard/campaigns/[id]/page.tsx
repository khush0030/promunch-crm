"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Send, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Campaign = {
  id: string;
  name: string;
  subject: string | null;
  preview_text: string | null;
  body_html: string | null;
  status: string;
  total_sent: number | null;
  total_delivered: number | null;
  total_opened: number | null;
  total_clicked: number | null;
  total_bounced: number | null;
  total_unsubscribed: number | null;
  revenue_attributed: number | null;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  email_count?: number;
};

const statusPill: Record<string, { cls: string; label: string }> = {
  draft: { cls: "grey", label: "Draft" },
  scheduled: { cls: "blue", label: "Scheduled" },
  sending: { cls: "amber", label: "Sending" },
  sent: { cls: "green", label: "Sent" },
  paused: { cls: "amber", label: "Paused" },
  failed: { cls: "accent", label: "Failed" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pct(num: number | null, den: number | null): string {
  if (!den || !num) return "0%";
  return ((num / den) * 100).toFixed(1) + "%";
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const res = await fetch(`/api/campaigns/${id}`);
      const data = await res.json();
      if (res.ok && data.campaign) setCampaign(data.campaign);
      setLoaded(true);
    })();
  }, [id]);

  async function handleSend() {
    if (!campaign) return;
    if (!confirm(`Send "${campaign.name}" now?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${id}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      toast.push({ kind: "success", text: "Campaign sent." });
      const refreshed = await fetch(`/api/campaigns/${id}`).then((r) => r.json());
      if (refreshed.campaign) setCampaign(refreshed.campaign);
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Send failed" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!campaign) return;
    if (!confirm(`Delete "${campaign.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.push({ kind: "success", text: "Campaign deleted." });
      router.push("/dashboard/campaigns");
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="page">
        <div className="muted">Loading…</div>
      </div>
    );
  }
  if (!campaign) {
    return (
      <div className="page">
        <div className="muted">
          Campaign not found.{" "}
          <Link href="/dashboard/campaigns" style={{ color: "var(--accent)" }}>
            Back
          </Link>
        </div>
      </div>
    );
  }

  const sp = statusPill[campaign.status] || statusPill.draft;
  const sent = campaign.total_sent || 0;
  const opened = campaign.total_opened || 0;
  const clicked = campaign.total_clicked || 0;
  const delivered = campaign.total_delivered || 0;
  const bounced = campaign.total_bounced || 0;
  const unsubscribed = campaign.total_unsubscribed || 0;
  const revenue = Number(campaign.revenue_attributed) || 0;
  const recipients = campaign.email_count || sent || 0;

  return (
    <div className="page">
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1>{campaign.name}</h1>
            <span className={`pill ${sp.cls}`}>{sp.label}</span>
          </div>
          <div className="sub">
            {campaign.sent_at ? `Sent ${fmtDate(campaign.sent_at)}` : `Created ${fmtDate(campaign.created_at)}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {campaign.status !== "sent" && (
            <button type="button" className="btn primary" onClick={handleSend} disabled={busy}>
              <Send size={14} /> {busy ? "Sending…" : "Send now"}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={handleDelete}
            disabled={busy}
            style={{ color: "var(--accent)", borderColor: "var(--accent-soft)" }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <Stat label="Recipients" value={recipients.toLocaleString()} />
        <Stat label="Delivered" value={delivered.toLocaleString()} sub={pct(delivered, sent)} />
        <Stat label="Opened" value={opened.toLocaleString()} sub={pct(opened, sent)} />
        <Stat label="Clicked" value={clicked.toLocaleString()} sub={pct(clicked, sent)} />
      </div>

      <div className="grid-2 section">
        <div className="card card-pad">
          <div className="card-title">Performance funnel</div>
          {sent > 0 ? (
            <div style={{ marginTop: 14 }}>
              <Bar label="Sent" value={sent} max={sent} color="var(--blue)" />
              <Bar label="Delivered" value={delivered} max={sent} color="var(--accent)" />
              <Bar label="Opened" value={opened} max={sent} color="var(--amber)" />
              <Bar label="Clicked" value={clicked} max={sent} color="var(--green)" />
            </div>
          ) : (
            <div className="muted" style={{ padding: "32px 0", textAlign: "center", fontSize: 13 }}>
              No sends yet
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="card-title">Health</div>
          <div style={{ marginTop: 14 }}>
            <Bar label="Bounced" value={bounced} max={sent || 1} color="var(--amber)" />
            <Bar label="Unsubscribed" value={unsubscribed} max={sent || 1} color="var(--text-3)" />
            <div className="stat-line" style={{ borderTop: "1px solid var(--border)", marginTop: 12 }}>
              <span>Revenue attributed</span>
              <span className="v" style={{ color: revenue > 0 ? "var(--green)" : "var(--text-3)" }}>
                {revenue > 0 ? `₹${revenue.toLocaleString("en-IN")}` : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-title">Content</div>
        <div className="meta-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <div className="k">Subject</div>
            <div className="v">{campaign.subject || "—"}</div>
          </div>
          <div>
            <div className="k">Preview</div>
            <div className="v muted">{campaign.preview_text || "—"}</div>
          </div>
        </div>
        {campaign.body_html ? (
          <div
            style={{
              marginTop: 18,
              padding: 16,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--hover)",
              maxHeight: 400,
              overflow: "auto",
            }}
            dangerouslySetInnerHTML={{ __html: campaign.body_html }}
          />
        ) : (
          <div className="muted" style={{ marginTop: 18, fontSize: 13 }}>
            No HTML body yet.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="delta flat">{sub}</div>}
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
        <span>{label}</span>
        <span className="num" style={{ fontWeight: 500 }}>
          {value.toLocaleString()}{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            ({w.toFixed(1)}%)
          </span>
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}
