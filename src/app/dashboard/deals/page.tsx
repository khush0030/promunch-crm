"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, PackageCheck, Trophy, AlertTriangle } from "lucide-react";
import {
  DataTable,
  EmptyState,
  FilterChips,
  KpiCard,
  PageHead,
  Panel,
  SearchBar,
  SectionLabel,
  StatusBadge,
  Tabs,
  Toolbar,
  type Chip,
  type Column,
} from "@/components/pm";
import { BoardView } from "@/components/deals/BoardView";
import { DealDrawer } from "@/components/deals/DealDrawer";
import {
  ALL_KINDS,
  DEFAULT_HIDDEN_KINDS,
  KIND_LABEL,
  KIND_TONE,
  PRIORITY_KIND,
  STAGE_LABEL,
  STAGE_TONE,
} from "@/components/deals/constants";
import { daysSince, timeAgo } from "@/components/deals/format";
import type { Deal, DealsResponse } from "@/components/deals/types";

const ACTIVE = ["new_inquiry", "in_discussion", "samples_requested", "samples_sent", "negotiation"];

export default function DealsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("pipeline");
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

  const kpis = useMemo(() => {
    const real = deals.filter((d) => !(DEFAULT_HIDDEN_KINDS as string[]).includes(d.kind));
    const active = real.filter((d) => ACTIVE.includes(d.stage));
    const horeca = active.filter((d) => d.kind === PRIORITY_KIND);
    const followUps = real.filter((d) => d.follow_up_needed);
    const waitingOnUs = followUps.filter((d) => d.last_email_direction === "inbound");
    const inFlight = real.filter((d) => d.stage === "samples_sent");
    const oldest = Math.max(0, ...inFlight.map((d) => daysSince(d.samples_sent_at) ?? 0));
    const won = real.filter((d) => d.stage === "won");
    return {
      active: active.length,
      horeca: horeca.length,
      followUps: followUps.length,
      waitingOnUs: waitingOnUs.length,
      inFlight: inFlight.length,
      oldest,
      won: won.length,
    };
  }, [deals]);

  const attention = useMemo(
    () =>
      deals
        .filter((d) => d.follow_up_needed && !(DEFAULT_HIDDEN_KINDS as string[]).includes(d.kind))
        .sort((a, b) => {
          const pa = a.kind === PRIORITY_KIND ? 0 : 1;
          const pb = b.kind === PRIORITY_KIND ? 0 : 1;
          if (pa !== pb) return pa - pb;
          return (a.last_email_at ?? "").localeCompare(b.last_email_at ?? "");
        })
        .slice(0, 6),
    [deals],
  );

  const chips: Chip[] = [
    { key: "all", label: "All kinds" },
    ...ALL_KINDS.map((k) => ({ key: k, label: KIND_LABEL[k] })),
  ];

  const columns: Column<Deal>[] = [
    { header: "Company", cell: (d) => <b>{d.company_name}</b> },
    { header: "Kind", cell: (d) => <StatusBadge tone={KIND_TONE[d.kind]}>{KIND_LABEL[d.kind]}</StatusBadge> },
    { header: "Stage", cell: (d) => <StatusBadge tone={STAGE_TONE[d.stage]}>{STAGE_LABEL[d.stage]}</StatusBadge> },
    {
      header: "Next step",
      cell: (d) => <span style={{ color: "var(--pm-muted)" }}>{d.next_step || "—"}</span>,
    },
    {
      header: "Follow-up",
      cell: (d) =>
        d.follow_up_needed ? (
          <span style={{ color: "var(--pm-terra)", fontWeight: 600, fontSize: 12 }}>
            {d.follow_up_reason || "needed"}
          </span>
        ) : (
          <span style={{ color: "var(--pm-hint)" }}>—</span>
        ),
    },
    { header: "Emails", align: "right", cell: (d) => d.email_count },
    { header: "Last activity", align: "right", cell: (d) => timeAgo(d.last_email_at) },
  ];

  const scan = data?.scan;
  const lastScan = scan?.last_run_at ? timeAgo(scan.last_run_at) : "never";

  return (
    <div className="pm-page">
      <PageHead
        title="Deals"
        subtitle="Every commercial conversation in hello@promunch.in — HoReCa supply first, then retail, influencer collabs and expos."
        actions={
          <>
            <span style={{ fontSize: 11.5, color: "var(--pm-hint)" }}>
              Last scan {lastScan}
              {scan && !scan.backfill_done ? " · backfill in progress" : ""}
            </span>
            <button
              type="button"
              className="pm-btn primary"
              disabled={scanNow.isPending}
              onClick={() => scanNow.mutate()}
            >
              {scanNow.isPending ? "Scanning…" : "Scan inbox now"}
            </button>
          </>
        }
      />

      {scanNow.error instanceof Error && (
        <p style={{ color: "var(--pm-terra)", fontSize: 12.5 }}>{scanNow.error.message}</p>
      )}
      {scan?.last_error && (
        <p style={{ color: "var(--pm-terra)", fontSize: 12.5 }}>Last scan error: {scan.last_error}</p>
      )}

      <div className="pm-kpis">
        <KpiCard
          label="Active HoReCa deals"
          value={kpis.horeca}
          icon={<Handshake />}
          tone="g"
          sub={`${kpis.active} active overall`}
        />
        <KpiCard
          label="Needs follow-up"
          value={kpis.followUps}
          icon={<AlertTriangle />}
          tone="t"
          valueColor="var(--pm-terra)"
          sub={`${kpis.waitingOnUs} waiting on our reply`}
        />
        <KpiCard
          label="Samples in flight"
          value={kpis.inFlight}
          icon={<PackageCheck />}
          tone="o"
          sub={kpis.inFlight ? `oldest sent ${kpis.oldest}d ago` : "none right now"}
        />
        <KpiCard label="Won · live partners" value={kpis.won} icon={<Trophy />} tone="g" />
      </div>

      {attention.length > 0 && (
        <>
          <SectionLabel>Needs action</SectionLabel>
          <Panel>
            {attention.map((d, i) => (
              <div
                key={d.id}
                onClick={() => setOpenId(d.id)}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  padding: "9px 2px",
                  borderTop: i === 0 ? "none" : "1px solid var(--pm-line)",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 600, minWidth: 200 }}>{d.company_name}</span>
                <span style={{ color: "var(--pm-muted)", flex: 1, minWidth: 200 }}>
                  {d.follow_up_reason || d.next_step || "Follow up"}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--pm-terra)", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {timeAgo(d.last_email_at)}
                </span>
              </div>
            ))}
          </Panel>
        </>
      )}

      <div style={{ marginTop: 22 }}>
        <Tabs
          tabs={[
            { key: "pipeline", label: "Pipeline" },
            { key: "all", label: `All deals (${deals.length})` },
          ]}
          active={tab}
          onSelect={setTab}
        />
      </div>

      <Toolbar>
        <SearchBar value={q} onChange={setQ} placeholder="Search company, contact, summary…" />
        <button
          type="button"
          className={`pm-btn sm${onlyFollowUp ? " primary" : " ghost"}`}
          onClick={() => setOnlyFollowUp(!onlyFollowUp)}
        >
          Needs follow-up
        </button>
      </Toolbar>
      <FilterChips chips={chips} active={kind} onSelect={setKind} />

      <div style={{ marginTop: 14 }}>
        {isLoading ? (
          <p style={{ color: "var(--pm-hint)" }}>Loading deals…</p>
        ) : error instanceof Error ? (
          <p style={{ color: "var(--pm-terra)" }}>{error.message}</p>
        ) : deals.length === 0 ? (
          <EmptyState icon={<Handshake />} title="No deals yet">
            Run “Scan inbox now” — the scanner reads hello@promunch.in, finds commercial
            conversations, and builds the pipeline automatically.
          </EmptyState>
        ) : tab === "pipeline" ? (
          <BoardView deals={filtered} onOpen={setOpenId} />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(d) => d.id}
            onRowClick={(d) => setOpenId(d.id)}
            empty="No deals match the current filters"
          />
        )}
      </div>

      {openId && <DealDrawer dealId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
