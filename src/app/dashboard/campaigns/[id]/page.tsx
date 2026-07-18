"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Send, Trash2 } from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { useToast } from "@/components/ui/Toast";
import { apiFetch, ApiError } from "@/lib/api-fetch";
import { PageHead, KpiCard, Panel, MiniBar, StatusBadge } from "@/components/pm";
import type { BadgeTone } from "@/components/pm";

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

const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  draft: { tone: "gray", label: "Draft" },
  scheduled: { tone: "blue", label: "Scheduled" },
  sending: { tone: "gold", label: "Sending" },
  sent: { tone: "green", label: "Sent" },
  paused: { tone: "gold", label: "Paused" },
  failed: { tone: "terra", label: "Failed" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tryKey, setTryKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoaded(false);
      setLoadError(null);
      try {
        const data = await apiFetch<{ campaign?: Campaign }>(`/api/campaigns/${id}`);
        if (!cancelled && data.campaign) setCampaign(data.campaign);
      } catch (e) {
        // a real 404 falls through to the "Not found" screen; anything else is a load failure
        if (!cancelled && !(e instanceof ApiError && e.status === 404)) {
          setLoadError(e instanceof Error ? e.message : "Couldn't load campaign");
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [id, tryKey]);

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

  const backLink = (
    <Link href="/dashboard/campaigns" className="more" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--pm-muted)", fontSize: 12 }}>
      <ArrowLeft size={14} /> Back to campaigns
    </Link>
  );

  if (!loaded) return <div className="pm-page"><PageHead title="Campaign" subtitle="Loading…" /></div>;
  if (loadError && !campaign)
    return (
      <div className="pm-page">
        <PageHead
          back={backLink}
          title="Couldn’t load this campaign"
          subtitle={loadError}
          actions={
            <button className="pm-btn primary" onClick={() => setTryKey((k) => k + 1)}>
              <RefreshCw size={15} /> Retry
            </button>
          }
        />
      </div>
    );
  if (!campaign) return <div className="pm-page"><PageHead back={backLink} title="Not found" subtitle="This campaign doesn’t exist." /></div>;

  const sp = statusMeta[campaign.status] || statusMeta.draft;
  const sent = campaign.total_sent || 0;
  const opened = campaign.total_opened || 0;
  const clicked = campaign.total_clicked || 0;
  const delivered = campaign.total_delivered || 0;
  const bounced = campaign.total_bounced || 0;
  const unsubscribed = campaign.total_unsubscribed || 0;
  const revenue = Number(campaign.revenue_attributed) || 0;
  const recipients = campaign.email_count || sent || 0;

  return (
    <div className="pm-page">
      <PageHead
        back={backLink}
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>{campaign.name} <StatusBadge tone={sp.tone}>{sp.label}</StatusBadge></span>}
        subtitle={campaign.sent_at ? `Sent ${fmtDate(campaign.sent_at)}` : `Created ${fmtDate(campaign.created_at)}`}
        actions={
          <>
            {campaign.status !== "sent" && (
              <button className="pm-btn primary" onClick={handleSend} disabled={busy}><Send size={15} /> {busy ? "Sending…" : "Send now"}</button>
            )}
            <button className="pm-btn ghost" onClick={handleDelete} disabled={busy} style={{ color: "var(--pm-terra)" }}><Trash2 size={15} /> Delete</button>
          </>
        }
      />

      <div className="pm-kpis">
        <KpiCard label="Recipients" value={recipients.toLocaleString()} tone="b" />
        <KpiCard label="Delivered" value={delivered.toLocaleString()} tone="g" sub={pct(delivered, sent)} />
        <KpiCard label="Opened" value={opened.toLocaleString()} tone="o" sub={pct(opened, sent)} />
        <KpiCard label="Clicked" value={clicked.toLocaleString()} tone="t" sub={pct(clicked, sent)} />
      </div>

      <div className="pm-grid g-11" style={{ marginTop: 16 }}>
        <Panel title="Performance funnel">
          {sent > 0 ? (
            <div style={{ marginTop: 4 }}>
              <MiniBar label="Sent" value={sent.toLocaleString()} pct={100} color="var(--pm-blue)" />
              <MiniBar label="Delivered" value={delivered.toLocaleString()} pct={sent ? (delivered / sent) * 100 : 0} color="var(--pm-green)" />
              <MiniBar label="Opened" value={opened.toLocaleString()} pct={sent ? (opened / sent) * 100 : 0} color="var(--pm-gold)" />
              <MiniBar label="Clicked" value={clicked.toLocaleString()} pct={sent ? (clicked / sent) * 100 : 0} color="var(--pm-terra)" />
            </div>
          ) : (
            <div className="pm-dim" style={{ padding: "32px 0", textAlign: "center", fontSize: 13 }}>No sends yet</div>
          )}
        </Panel>

        <Panel title="Health">
          <div style={{ marginTop: 4 }}>
            <MiniBar label="Bounced" value={bounced.toLocaleString()} pct={sent ? (bounced / sent) * 100 : 0} color="var(--pm-gold)" />
            <MiniBar label="Unsubscribed" value={unsubscribed.toLocaleString()} pct={sent ? (unsubscribed / sent) * 100 : 0} color="var(--pm-hint)" />
            <div className="pm-pill" style={{ borderTop: "1px solid var(--pm-line)", marginTop: 8 }}>
              <span className="nm">Revenue attributed</span>
              <span className="pm-b7" style={{ color: revenue > 0 ? "var(--pm-green)" : "var(--pm-hint)" }}>{revenue > 0 ? `₹${revenue.toLocaleString("en-IN")}` : "—"}</span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Content" style={{ marginTop: 14 }}>
        <div className="pm-frow" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <div className="pm-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>Subject</div>
            <div style={{ fontSize: 13.5 }}>{campaign.subject || "—"}</div>
          </div>
          <div>
            <div className="pm-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>Preview</div>
            <div className="pm-muted" style={{ fontSize: 13.5 }}>{campaign.preview_text || "—"}</div>
          </div>
        </div>
        {campaign.body_html ? (
          <div
            style={{ marginTop: 18, padding: 16, border: "1px solid var(--pm-line)", borderRadius: 10, background: "var(--pm-card2)", maxHeight: 400, overflow: "auto" }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(campaign.body_html) }}
          />
        ) : (
          <div className="pm-dim" style={{ marginTop: 18, fontSize: 13 }}>No HTML body yet.</div>
        )}
      </Panel>
    </div>
  );
}
