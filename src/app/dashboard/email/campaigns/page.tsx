"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Table, Pill, Callout, ConfirmDialog } from "@/components/pm";
import type { PillTone } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { NewCampaignButton } from "@/components/email-studio/NewCampaignButton";
import { getJson, sendJson, inr, pct, when } from "@/components/email-studio/api";
import s from "@/components/email-studio/studio.module.css";

type Row = {
  id: string;
  name: string;
  subject: string | null;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  total_recipients: number | null;
  total_sent: number | null;
  total_clicked: number | null;
  approval_status?: string;
  created_by?: string | null;
  builder?: boolean;
  orders?: number;
  revenue?: number;
};

function statusPill(r: Row): { tone: PillTone; label: string } {
  if (r.approval_status === "pending") return { tone: "warn", label: "Needs approval" };
  if (r.approval_status === "rejected" && r.status === "draft") return { tone: "crit", label: "Rejected" };
  switch (r.status) {
    case "sent": return { tone: "good", label: "Sent" };
    case "sending": return { tone: "info", label: "Sending" };
    case "scheduled": return { tone: "brand", label: "Scheduled" };
    case "paused": return { tone: "warn", label: "Paused" };
    default: return { tone: "neu", label: "Draft" };
  }
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "pending", label: "Needs approval" },
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent" },
];

export default function CampaignsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [del, setDel] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["email-studio-campaigns"],
    queryFn: () => getJson<{ campaigns: Row[]; warning?: string }>("/api/email-studio/campaigns"),
  });
  const rows = (q.data?.campaigns ?? []).filter((r) =>
    filter === "all" ? true : filter === "pending" ? r.approval_status === "pending" : filter === "draft" ? ["draft", "paused"].includes(r.status) && r.approval_status !== "pending" : r.status === filter,
  );

  return (
    <>
      <StudioHeader tab="campaigns" title="Campaigns" actions={<NewCampaignButton />} />
      <div className="pm2-body">
        {q.data?.warning && <Callout tone="sun" title="Email Studio isn't fully set up" body={q.data.warning} />}
        <div className="pm2-chips">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={`pm2-chip ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        {q.isLoading ? (
          <div className="pm2-skel" />
        ) : (
          <div className="pm2-panel">
            <Table<Row>
              cols={[
                {
                  h: "Campaign",
                  render: (r) => (
                    <Link href={`/dashboard/email/campaigns/${r.id}`} style={{ display: "grid", color: "inherit", textDecoration: "none" }}>
                      <b>{r.name}</b>
                      <span className={s.hint}>{r.subject || "No subject yet"}</span>
                    </Link>
                  ),
                },
                { h: "Status", render: (r) => { const p = statusPill(r); return <Pill tone={p.tone}>{p.label}</Pill>; } },
                { h: "When", render: (r) => when(r.sent_at || r.scheduled_at || r.created_at) },
                { h: "Sent", num: true, render: (r) => (r.total_sent ? r.total_sent.toLocaleString("en-IN") : "–") },
                { h: "Click rate", num: true, render: (r) => (r.total_sent ? pct((r.total_clicked ?? 0) / r.total_sent) : "–") },
                { h: "Revenue", num: true, render: (r) => (r.revenue ? inr(r.revenue) : "–") },
                {
                  h: "",
                  render: (r) =>
                    ["draft", "paused"].includes(r.status) && !r.total_sent ? (
                      <button
                        type="button"
                        className={s.iconBtn}
                        aria-label="Delete draft"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDel(r);
                        }}
                      >
                        <Trash2 />
                      </button>
                    ) : null,
                },
              ]}
              rows={rows}
              rowKey={(r) => r.id}
              empty={
                <div style={{ padding: 24, display: "grid", gap: 10, justifyItems: "start" }}>
                  <span className={s.hint}>No campaigns here yet.</span>
                  <NewCampaignButton label="Create your first campaign" />
                </div>
              }
            />
          </div>
        )}
      </div>
      {del && (
        <ConfirmDialog
          title={`Delete "${del.name}"?`}
          body="This draft will be removed. Nothing has been sent."
          confirmLabel="Delete"
          danger
          busy={busy}
          onClose={() => setDel(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await sendJson(`/api/email-studio/campaigns/${del.id}`, "DELETE");
              qc.invalidateQueries({ queryKey: ["email-studio-campaigns"] });
              setDel(null);
            } catch (e) {
              toast.push({ kind: "error", text: (e as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
