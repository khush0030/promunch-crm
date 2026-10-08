"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Trash2 } from "lucide-react";
import { Callout, Chips, ConfirmDialog } from "@/components/pm";
import type { ChipItem } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { StudioHeader } from "@/components/email-studio/StudioHeader";
import { NewCampaignButton } from "@/components/email-studio/NewCampaignButton";
import { getJson, sendJson, inr, pct, when, niceText } from "@/components/email-studio/api";
import l from "@/components/email-studio/list.module.css";

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

function statusOf(r: Row): { cls: string; label: string } {
  if (r.approval_status === "pending") return { cls: l.stWarn, label: "Needs approval" };
  if (r.approval_status === "rejected" && r.status === "draft") return { cls: l.stCrit, label: "Sent back" };
  switch (r.status) {
    case "sent": return { cls: l.stPlain, label: "Sent" };
    case "sending": return { cls: l.stGood, label: "Sending" };
    case "scheduled": return { cls: l.stInfo, label: "Scheduled" };
    case "paused": return { cls: l.stWarn, label: "Paused" };
    default: return { cls: l.stNeu, label: "Draft" };
  }
}

function matches(r: Row, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return r.approval_status === "pending";
  if (filter === "draft") return ["draft", "paused"].includes(r.status) && r.approval_status !== "pending";
  return r.status === filter;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "pending", label: "Needs approval" },
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent" },
];

function Nil() {
  return <i className={l.nil} aria-label="none yet">–</i>;
}

function greyLine(r: Row): string {
  const by = r.created_by ? `By ${r.created_by.split("@")[0]} · ` : "";
  if (r.status === "sent" && r.sent_at) return `Sent ${when(r.sent_at)}`;
  if (r.status === "scheduled" && r.scheduled_at) return `Goes out ${when(r.scheduled_at)}`;
  if (r.approval_status === "pending") return `${by}${when(r.created_at)}`;
  return r.subject ? niceText(r.subject) : `Draft · ${when(r.created_at)}`;
}

export default function CampaignsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [del, setDel] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["email-studio-campaigns"],
    queryFn: () => getJson<{ campaigns: Row[]; warning?: string }>("/api/email-studio/campaigns"),
  });
  const all = q.data?.campaigns ?? [];
  const rows = all.filter((r) => matches(r, filter));
  const chips: ChipItem[] = FILTERS.map((f) => {
    const n = f.key === "all" ? 0 : all.filter((r) => matches(r, f.key)).length;
    return { key: f.key, label: f.label, count: n > 0 && (f.key === "draft" || f.key === "pending") ? n : undefined };
  });

  return (
    <>
      <StudioHeader
        tab="campaigns"
        title="Campaigns"
        summary="One email to many people. Every campaign is approved by an admin before it sends, and only goes to people with an email who said yes."
        actions={<NewCampaignButton />}
      />
      <div className="pm2-body">
        {q.data?.warning && <Callout tone="plain" title="Email Studio isn't fully set up" body={q.data.warning} />}
        <div className={l.chipsWrap}>
          <Chips items={chips} value={filter} onChange={setFilter} ariaLabel="Filter campaigns" />
        </div>
        {q.isLoading ? (
          <div className="pm2-skel" />
        ) : (
          <div className={l.card}>
            {rows.length === 0 ? (
              <div className={l.empty}>
                <span>No campaigns here yet.</span>
                <NewCampaignButton label="Create your first campaign" primary={false} />
              </div>
            ) : (
              <table className={l.tbl}>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th className={l.r}>Sent</th>
                    <th className={l.r}>Click rate</th>
                    <th className={l.r}>Revenue</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = statusOf(r);
                    // Only real sends count, so a draft never looks sent. The list only
                    // has open EVENTS (not unique openers), so the one rate shown is the
                    // click rate, computed exactly as before the redesign.
                    const sent = r.total_sent || 0;
                    const clickRate = r.total_sent ? pct((r.total_clicked ?? 0) / r.total_sent) : null;
                    const href = `/dashboard/email/campaigns/${r.id}`;
                    const canDelete = ["draft", "paused"].includes(r.status) && !r.total_sent;
                    return (
                      <tr key={r.id} onClick={() => router.push(href)}>
                        <td className={l.main}>
                          <Link href={href} className={l.name} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                          <span className={l.sub}>{greyLine(r)}</span>
                        </td>
                        <td className={l.meta}><span className={`${l.status} ${st.cls}`}>{st.label}</span></td>
                        <td className={`${l.meta} ${l.r}`}>{sent ? <span className={l.num}>{sent.toLocaleString("en-IN")}</span> : <Nil />}</td>
                        <td className={`${l.meta} ${l.r}`}>{clickRate ? <span className={l.num}>{clickRate}</span> : <Nil />}</td>
                        <td className={`${l.meta} ${l.r}`}>{r.revenue ? <b className={l.money}>{inr(r.revenue)}</b> : <Nil />}</td>
                        <td className={l.metaLine}>
                          <span className={`${l.status} ${st.cls}`}>{st.label}</span>
                          {sent > 0 && <span className={l.metaPart}><b>{sent.toLocaleString("en-IN")}</b> <span>{sent === 1 ? "person" : "people"}</span></span>}
                          {clickRate && <span className={l.metaPart}><b>{clickRate}</b> <span>click rate</span></span>}
                          {!!r.revenue && <span className={l.metaPart}><b>{inr(r.revenue)}</b></span>}
                        </td>
                        <td className={l.end}>
                          <span className={l.endIn}>
                            {canDelete && (
                              <button
                                type="button"
                                className={l.iconBtn}
                                aria-label="Delete draft"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDel(r);
                                }}
                              >
                                <Trash2 />
                              </button>
                            )}
                            <span className={`${l.iconBtn} ${l.chev}`} aria-hidden><ChevronRight /></span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
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
