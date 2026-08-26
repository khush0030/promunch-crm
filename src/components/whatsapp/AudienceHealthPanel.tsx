"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, HeartHandshake, SendHorizonal, Ban, RefreshCw } from "lucide-react";
import { KpiCard, Panel } from "@/components/pm";
import type { KpiTone } from "@/components/pm";
import { useToast } from "@/components/ui/Toast";
import { TIERS, TIER_META, type Tier } from "@/lib/wa-engagement";
import { smallBtn } from "./styles";

// The scoreboard for whether the audience-quality work is actually working.
// Deliberately unflattering: it leads with how much of the list has never
// spoken to us and what Meta does with messages to those people.
//
// Everything is computed in SQL from production rows (wa_audience_health(),
// migration 014) — no estimates, no invented rates.

export type EngagementHealth = {
  total: number;
  optedIn: number;
  byTier: Record<Tier, number>;
  engaged: number;
  suppressed: number;
  marketing30d: { sent: number; failed: number; delivered: number; deliveryRate: number | null };
  warm30d: { sent: number; failed: number; deliveryRate: number | null };
  cold30d: { sent: number; failed: number; deliveryRate: number | null; blockRate: number | null };
  inbound30d: number;
  consent30d: number;
  consentTotal: number;
  generatedAt: string;
};

const num = (n: number) => n.toLocaleString("en-IN");
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export function useEngagementHealth() {
  return useQuery({
    queryKey: ["wa-engagement"],
    queryFn: async (): Promise<EngagementHealth | { needsMigration: true; hint?: string }> => {
      const r = await fetch("/api/whatsapp/engagement");
      const j = await r.json();
      if (!r.ok) {
        if (j?.needsMigration) return { needsMigration: true as const, hint: j.hint };
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      return j as EngagementHealth;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export default function AudienceHealthPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error } = useEngagementHealth();

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/whatsapp/engagement/refresh", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) {
        toast.push({ kind: "error", text: "Tier refresh failed: " + (j.hint || j.error || `HTTP ${r.status}`) });
      } else {
        toast.push({ kind: "success", text: `Tiers refreshed — ${num(j.changed ?? 0)} contact(s) changed tier.` });
        qc.invalidateQueries({ queryKey: ["wa-engagement"] });
        qc.invalidateQueries({ queryKey: ["wa-audience"] });
      }
    } finally { setRefreshing(false); }
  }

  if (isLoading) {
    return <Panel title="Audience quality" caption="Loading…"><div style={{ height: 40 }} /></Panel>;
  }
  if (error) {
    return (
      <Panel title="Audience quality">
        <div style={{ fontSize: 12.5, color: "var(--pm-terra)" }}>
          Could not load audience health: {String((error as Error).message)}
        </div>
      </Panel>
    );
  }
  if (!data || "needsMigration" in data) {
    return (
      <Panel title="Audience quality" caption="Engagement tiering is not switched on yet.">
        <div style={{ fontSize: 12.5, color: "var(--pm-muted)", lineHeight: 1.5 }}>
          {(data as { hint?: string })?.hint ??
            "Apply supabase/migrations/014_wa_engagement_tiers_and_consent.sql in the Supabase SQL editor to switch on engagement tiers."}
        </div>
      </Panel>
    );
  }

  const h = data;
  const engagedShare = h.total > 0 ? h.engaged / h.total : 0;
  const never = (h.byTier.imported ?? 0) + (h.byTier.suppressed ?? 0);

  const tiles: Array<{
    label: string; value: string; sub: string; icon: React.ReactNode; tone: KpiTone; color?: string;
  }> = [
    {
      label: "WhatsApp contacts",
      value: num(h.total),
      sub: `${num(h.optedIn)} flagged opted-in`,
      icon: <Users />, tone: "b",
    },
    {
      label: "Genuinely engaged",
      value: num(h.engaged),
      sub: `${pct(engagedShare)} of the list has messaged us in 90 days`,
      icon: <HeartHandshake />, tone: "g",
      color: h.engaged > 0 ? "var(--pm-green)" : "var(--pm-terra)",
    },
    {
      label: "Marketing delivered · 30d",
      value: pct(h.marketing30d.deliveryRate),
      sub: `${num(h.marketing30d.delivered)} of ${num(h.marketing30d.sent)} got through`,
      icon: <SendHorizonal />, tone: "o",
      color:
        h.marketing30d.deliveryRate == null ? undefined
          : h.marketing30d.deliveryRate >= 0.6 ? "var(--pm-green)"
          : h.marketing30d.deliveryRate >= 0.3 ? "var(--pm-gold)"
          : "var(--pm-terra)",
    },
    {
      label: "Suppressed",
      value: num(h.suppressed),
      sub: "opted out, or refused 3+ times by Meta",
      icon: <Ban />, tone: "t",
      color: h.suppressed > 0 ? "var(--pm-terra)" : undefined,
    },
  ];

  return (
    <Panel
      title="Audience quality"
      caption={`${num(never)} of ${num(h.total)} contacts have never sent us a message. Refreshed ${new Date(h.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`}
      more={
        <button type="button" onClick={refresh} disabled={refreshing} style={smallBtn}>
          <RefreshCw size={12} /> {refreshing ? "Refreshing…" : "Refresh tiers"}
        </button>
      }
      style={{ marginBottom: 18 }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginBottom: 16 }}>
        {tiles.map((t) => (
          <KpiCard key={t.label} label={t.label} value={t.value} sub={t.sub} icon={t.icon} tone={t.tone} valueColor={t.color} />
        ))}
      </div>

      <TierBar byTier={h.byTier} total={h.total} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10, marginTop: 16 }}>
        <Compare
          title="Sent to people who have replied to us"
          rate={h.warm30d.deliveryRate}
          detail={`${num(h.warm30d.sent - h.warm30d.failed)} of ${num(h.warm30d.sent)} delivered · last 30 days`}
          good
        />
        <Compare
          title="Sent to people who never have"
          rate={h.cold30d.deliveryRate}
          detail={`${num(h.cold30d.sent - h.cold30d.failed)} of ${num(h.cold30d.sent)} delivered · last 30 days`}
        />
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: "var(--pm-muted)", lineHeight: 1.55 }}>
        <strong style={{ color: "var(--pm-ink)" }}>{num(h.inbound30d)}</strong> people messaged us in the last 30 days.{" "}
        <strong style={{ color: "var(--pm-ink)" }}>{num(h.consentTotal)}</strong> contacts have a recorded opt-in with the
        wording they agreed to ({num(h.consent30d)} added in the last 30 days).{" "}
        {h.consentTotal === 0
          ? "Every other number came from an order or an import, which is why Meta treats this list as cold. The storefront popup on the Growth tab is the way to fix that."
          : "Growing that number is the only durable fix for the delivery rate above."}
      </div>
    </Panel>
  );
}

// Stacked share of the list by tier, with a legend that spells each tier out.
function TierBar({ byTier, total }: { byTier: Record<Tier, number>; total: number }) {
  if (!total) return null;
  return (
    <div>
      <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", border: "1px solid var(--pm-border)" }}>
        {TIERS.map((t) => {
          const n = byTier[t] ?? 0;
          if (!n) return null;
          return (
            <div
              key={t}
              title={`${TIER_META[t].label}: ${num(n)}`}
              style={{ width: `${(n / total) * 100}%`, background: TIER_META[t].color }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 10 }}>
        {TIERS.map((t) => {
          const n = byTier[t] ?? 0;
          return (
            <div key={t} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12 }} title={TIER_META[t].hint}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: TIER_META[t].color, display: "inline-block" }} />
              <span style={{ fontWeight: 700 }}>{num(n)}</span>
              <span style={{ color: "var(--pm-muted)" }}>{TIER_META[t].label}</span>
              <span style={{ color: "var(--pm-hint)" }}>{total ? `${Math.round((n / total) * 100)}%` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Compare({ title, rate, detail, good }: { title: string; rate: number | null; detail: string; good?: boolean }) {
  const color = rate == null ? "var(--pm-muted)" : good ? "var(--pm-green)" : "var(--pm-terra)";
  return (
    <div style={{ border: "1px solid var(--pm-border)", borderRadius: 10, padding: "11px 13px", background: "var(--pm-app)" }}>
      <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color }}>
        {rate == null ? "no sends" : pct(rate)}
      </div>
      <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 2 }}>{detail}</div>
    </div>
  );
}
