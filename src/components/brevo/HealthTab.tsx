"use client";

import { useQuery } from "@tanstack/react-query";
import { KpiStrip, Kpi, Card, Table, Pill, Callout } from "@/components/pm";
import type { TableCol } from "@/components/pm";
import type { HealthResponse } from "@/app/api/brevo/health/route";
import type { BrevoSender, DnsRow } from "@/lib/brevo-shape";
import { int, day, clock, getJson, ErrorCallout, SectionView } from "./format";
import { WebhooksCard } from "./WebhooksCard";

export const healthKey = ["brevo-health"] as const;

const PROCESS_LABEL: Record<string, string> = { IMPORTUSER: "Contact import", EXPORTUSER: "Contact export", EXPORT_RECIPIENTS: "Recipient export", "TRANS-GLOBAL-CALC": "Stats recalculation" };

export function HealthTab() {
  const q = useQuery({ queryKey: healthKey, queryFn: () => getJson<HealthResponse>("/api/brevo/health") });

  if (q.isLoading) return <div className="pm2-skel" />;
  if (q.isError || !q.data) return <ErrorCallout title="Couldn't load Brevo health" error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data;

  const senderCols: TableCol<BrevoSender>[] = [
    { h: "Name", key: "name" },
    { h: "Email", key: "email" },
    { h: "Status", render: (s) => <Pill tone={s.active ? "good" : "warn"}>{s.active ? "verified" : "inactive"}</Pill> },
  ];
  const dnsCols: TableCol<DnsRow>[] = [
    { h: "Record", render: (r) => r.label },
    { h: "Type", key: "type" },
    { h: "Host", render: (r) => <code>{r.host}</code> },
    { h: "Value", render: (r) => <code style={{ wordBreak: "break-all" }}>{r.value}</code> },
    { h: "Status", render: (r) => <Pill tone={r.ok ? "good" : "crit"}>{r.ok ? "ok" : "failing"}</Pill> },
  ];

  return (
    <>
      {h.issues.length > 0 && (
        <Card title="Needs attention" basis={`${h.issues.length} item${h.issues.length === 1 ? "" : "s"} · checked ${clock(h.fetchedAt)}`}>
          <div style={{ display: "grid", gap: 10 }}>
            {h.issues.map((i) => (
              <Callout key={i.title} tone={i.tone === "crit" ? "crit" : i.tone === "warn" ? "sun" : "plain"} title={i.title} body={i.body} />
            ))}
          </div>
        </Card>
      )}

      <SectionView s={h.account} gatedTitle="Account details unavailable">
        {(a) => (
          <KpiStrip cols={a.plans.length >= 3 ? 4 : 3}>
            {a.plans.map((p) => (
              <Kpi
                key={p.label}
                label={p.label}
                value={p.credits != null ? int(p.credits) : "—"}
                sub={`${p.creditsType === "sendLimit" ? "email credits" : p.creditsType ?? "credits"}${p.endDate ? ` · until ${day(p.endDate)}` : ""}`}
              />
            ))}
            <Kpi label="Account" value={a.companyName ?? "—"} sub={a.email ?? ""} />
            <Kpi label="SMTP relay" value={a.relayEnabled ? "On" : "Off"} sub="for sending through SMTP" />
          </KpiStrip>
        )}
      </SectionView>

      <div className="pm2-g2">
        <Card title="Senders" basis="from addresses Brevo will send as">
          <SectionView s={h.senders} gatedTitle="Senders unavailable">
            {(senders) => <Table cols={senderCols} rows={senders} rowKey={(s) => s.id} card={(s) => ({ title: s.name, value: s.active ? "verified" : "inactive", meta: s.email })} empty="No senders" />}
          </SectionView>
        </Card>
        <Card title="Blocked recipients" basis="Brevo will not email these">
          <SectionView s={h.blockedContacts} gatedTitle="Blocked contacts unavailable">
            {(b) => (
              <>
                <div style={{ fontSize: 26, fontWeight: 650 }}>{int(b.count)}</div>
                <div style={{ fontSize: 12.5, color: "var(--pm-muted)" }}>blocked or unsubscribed (transactional)</div>
                <SectionView s={h.blockedDomains} gatedTitle="Blocked domains unavailable">
                  {(d) => <div style={{ marginTop: 10, fontSize: 13 }}>{d.length ? `Blocked domains: ${d.join(", ")}` : "No blocked domains."}</div>}
                </SectionView>
              </>
            )}
          </SectionView>
        </Card>
      </div>

      <SectionView s={h.domains} gatedTitle="Domains unavailable">
        {(domains) => (
          <>
            {domains.map((d) => (
              <Card
                key={d.domain}
                title={`Domain · ${d.domain}`}
                basis="DNS records that prove mail really comes from you"
                right={<Pill tone={d.authenticated && d.verified ? "good" : "crit"}>{d.authenticated && d.verified ? "authenticated" : "not authenticated"}</Pill>}
              >
                <Table cols={dnsCols} rows={d.dns} rowKey={(r) => r.key} card={(r) => ({ title: `${r.label} (${r.type})`, value: r.ok ? "ok" : "failing", meta: `${r.host} → ${r.value}` })} empty="No DNS records reported" />
              </Card>
            ))}
          </>
        )}
      </SectionView>

      <div className="pm2-g2">
        <WebhooksCard />
        <Card title="Background jobs" basis="imports and exports in Brevo">
          <SectionView s={h.processes} gatedTitle="Jobs unavailable">
            {(ps) => (
              <Table
                cols={[
                  { h: "Job", render: (p) => PROCESS_LABEL[p.name] ?? p.name },
                  { h: "#", num: true, render: (p) => p.id },
                  { h: "Status", render: (p) => <Pill tone={p.status === "completed" ? "good" : p.status === "failed" ? "crit" : "info"}>{p.status}</Pill> },
                ]}
                rows={ps}
                rowKey={(p) => p.id}
                card={(p) => ({ title: PROCESS_LABEL[p.name] ?? p.name, value: p.status, meta: `#${p.id}` })}
                empty="No jobs"
              />
            )}
          </SectionView>
        </Card>
      </div>
    </>
  );
}
