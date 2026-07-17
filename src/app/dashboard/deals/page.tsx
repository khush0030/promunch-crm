"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake } from "lucide-react";
import { EmptyState, PageHead, SearchBar, StatusBadge } from "@/components/pm";
import { DealDrawer } from "@/components/deals/DealDrawer";
import {
  ALL_KINDS,
  BUCKET_OF,
  BUCKETS,
  DEFAULT_HIDDEN_KINDS,
  KIND_LABEL,
  KIND_TONE,
  PRIORITY_KIND,
  TEMP_LABEL,
  type Bucket,
} from "@/components/deals/constants";
import { timeAgo } from "@/components/deals/format";
import type { Deal, DealsResponse } from "@/components/deals/types";

// One row, one deal: temperature dot · company · kind · next step · flag · age.
// HoReCa and flagged deals float to the top of each bucket.
function rank(a: Deal, b: Deal): number {
  if (a.follow_up_needed !== b.follow_up_needed) return a.follow_up_needed ? -1 : 1;
  const pa = a.kind === PRIORITY_KIND ? 0 : 1;
  const pb = b.kind === PRIORITY_KIND ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return (b.last_email_at ?? "").localeCompare(a.last_email_at ?? "");
}

const TEMP_DOT: Record<string, string> = {
  hot: "var(--pm-terra)",
  warm: "var(--pm-gold)",
  cool: "var(--pm-blue)",
};

export default function DealsPage() {
  const qc = useQueryClient();
  const [bucket, setBucket] = useState<Bucket>("inquiries");
  const [kind, setKind] = useState("all");
  const [onlyFollowUp, setOnlyFollowUp] = useState(false);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["deals"],
    queryFn: async (): Promise<DealsResponse> => {
      const res = await fetch("/api/deals", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "failed to load deals");
      return d;
    },
    refetchInterval: 120_000,
  });

  const scanNow = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/deals/scan", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "scan failed");
      return d;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["deals"] }),
  });

  const deals = useMemo(() => data?.deals ?? [], [data?.deals]);

  // Kind/search/follow-up filters apply across buckets so the segment counts
  // always reflect what the list below would show.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return deals.filter((d) => {
      if (kind === "all" && (DEFAULT_HIDDEN_KINDS as string[]).includes(d.kind)) return false;
      if (kind !== "all" && d.kind !== kind) return false;
      if (onlyFollowUp && !d.follow_up_needed) return false;
      if (
        needle &&
        ![d.company_name, d.company_domain, d.contact_name, d.contact_email, d.summary, d.next_step]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(needle))
      ) {
        return false;
      }
      return true;
    });
  }, [deals, kind, onlyFollowUp, q]);

  const byBucket = useMemo(() => {
    const m: Record<Bucket, Deal[]> = { inquiries: [], discussions: [], samples: [], orders: [], closed: [] };
    for (const d of filtered) m[BUCKET_OF[d.stage]].push(d);
    (Object.keys(m) as Bucket[]).forEach((k) => m[k].sort(rank));
    return m;
  }, [filtered]);

  const followUps = useMemo(
    () => deals.filter((d) => d.follow_up_needed && !(DEFAULT_HIDDEN_KINDS as string[]).includes(d.kind)).length,
    [deals],
  );

  const rows = byBucket[bucket];
  const scan = data?.scan;

  const segBtn = (active: boolean): React.CSSProperties => ({
    border: "none",
    background: active ? "var(--pm-green)" : "transparent",
    color: active ? "#fff" : "var(--pm-muted)",
    borderRadius: 999,
    padding: "6px 14px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    font: "inherit",
    whiteSpace: "nowrap",
  });

  return (
    <div className="pm-page">
      <PageHead
        title="Deals"
        subtitle={
          <>
            {followUps > 0 ? `${followUps} need your attention · ` : ""}
            last scan {scan?.last_run_at ? timeAgo(scan.last_run_at) : "never"}
            {scan && !scan.backfill_done ? " · still reading older mail" : ""}
          </>
        }
        actions={
          <button
            type="button"
            className="pm-btn ghost sm"
            disabled={scanNow.isPending}
            onClick={() => scanNow.mutate()}
          >
            {scanNow.isPending ? "Scanning…" : "Scan now"}
          </button>
        }
      />

      {(scanNow.error instanceof Error || scan?.last_error) && (
        <p style={{ color: "var(--pm-terra)", fontSize: 12.5, marginTop: 0 }}>
          {scanNow.error instanceof Error ? scanNow.error.message : `Last scan error: ${scan?.last_error}`}
        </p>
      )}

      {/* Segmented buckets + compact filters, one row */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--pm-card)",
            border: "1px solid var(--pm-border)",
            borderRadius: 999,
            padding: 3,
          }}
        >
          {BUCKETS.map((b) => (
            <button key={b.key} type="button" style={segBtn(bucket === b.key)} onClick={() => setBucket(b.key)}>
              {b.label} {byBucket[b.key].length > 0 && <span style={{ opacity: 0.75 }}>{byBucket[b.key].length}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          style={{
            ...segBtn(bucket === "closed"),
            background: bucket === "closed" ? "var(--pm-card2)" : "transparent",
            color: "var(--pm-hint)",
            border: bucket === "closed" ? "1px solid var(--pm-border)" : "1px solid transparent",
          }}
          onClick={() => setBucket("closed")}
        >
          Closed {byBucket.closed.length}
        </button>
        <span style={{ flex: 1 }} />
        <SearchBar value={q} onChange={setQ} placeholder="Search deals…" />
        <select
          value={kind}
          aria-label="Filter by kind"
          onChange={(e) => setKind(e.target.value)}
          style={{
            border: "1px solid var(--pm-border)",
            borderRadius: "var(--pm-r3)",
            background: "var(--pm-card)",
            color: "inherit",
            font: "inherit",
            fontSize: 12.5,
            padding: "7px 10px",
          }}
        >
          <option value="all">All kinds</option>
          {ALL_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`pm-btn sm${onlyFollowUp ? " primary" : " ghost"}`}
          onClick={() => setOnlyFollowUp(!onlyFollowUp)}
        >
          Needs follow-up
        </button>
      </div>

      {/* The list */}
      <div
        style={{
          marginTop: 14,
          background: "var(--pm-card)",
          border: "1px solid var(--pm-border)",
          borderRadius: "var(--pm-r2)",
          overflow: "hidden",
        }}
      >
        {isLoading ? (
          <p style={{ color: "var(--pm-hint)", padding: 20, margin: 0 }}>Loading deals…</p>
        ) : error instanceof Error ? (
          <p style={{ color: "var(--pm-terra)", padding: 20, margin: 0 }}>{error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Handshake />} title="Nothing here" style={{ border: "none" }}>
            {deals.length === 0
              ? "Hit “Scan now” — the pipeline builds itself from hello@promunch.in."
              : "No deals in this lane with the current filters."}
          </EmptyState>
        ) : (
          rows.map((d, i) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setOpenId(d.id)}
              className="deal-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                borderTop: i === 0 ? "none" : "1px solid var(--pm-line)",
                padding: "11px 16px",
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
              }}
            >
              <span
                title={d.interest_temp ? `${TEMP_LABEL[d.interest_temp]} lead` : "Not analysed yet"}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: d.interest_temp ? TEMP_DOT[d.interest_temp] : "var(--pm-line)",
                }}
              />
              <span style={{ fontWeight: 600, fontSize: 13, minWidth: 160, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.company_name}
              </span>
              <StatusBadge tone={KIND_TONE[d.kind]}>{KIND_LABEL[d.kind]}</StatusBadge>
              <span
                style={{
                  flex: 1,
                  color: "var(--pm-muted)",
                  fontSize: 12.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {d.next_step || d.summary || "—"}
              </span>
              {d.follow_up_needed && (
                <span style={{ color: "var(--pm-terra)", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                  ● follow up
                </span>
              )}
              <span style={{ fontSize: 11.5, color: "var(--pm-hint)", whiteSpace: "nowrap", width: 56, textAlign: "right" }}>
                {timeAgo(d.last_email_at)}
              </span>
            </button>
          ))
        )}
      </div>

      {openId && <DealDrawer dealId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
