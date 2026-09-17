"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/pm";
import type { PageHeaderTab } from "@/components/pm";
import { CampaignsTab } from "@/components/brevo/CampaignsTab";
import { ReportsTab } from "@/components/brevo/ReportsTab";
import { HealthTab } from "@/components/brevo/HealthTab";
import { AutomationsTab } from "@/components/brevo/AutomationsTab";
import { AudienceTab } from "@/components/brevo/AudienceTab";
import { CouponsTab } from "@/components/brevo/CouponsTab";
import { SmsTab } from "@/components/brevo/SmsTab";
import { getJson } from "@/components/brevo/format";

// Marketing > Email (Brevo). Hub for everything Brevo: campaigns, reports,
// automations, audience sync, coupons, SMS and account health. Tabs are
// URL-driven (?tab=) so links can deep-link.
// Plan: docs/plans/2026-09-17-brevo-integration.md

const TABS: PageHeaderTab[] = [
  { key: "campaigns", label: "Campaigns" },
  { key: "reports", label: "Reports" },
  { key: "automations", label: "Automations" },
  { key: "audience", label: "Audience" },
  { key: "coupons", label: "Coupons" },
  { key: "sms", label: "SMS" },
  { key: "health", label: "Health" },
];
type TabKey = "campaigns" | "reports" | "automations" | "audience" | "coupons" | "sms" | "health";
const TAB_KEYS = new Set<string>(TABS.map((t) => t.key));
type Period = "7d" | "30d" | "90d";

const BREVO_URL = "https://app.brevo.com/marketing-campaign/list";

// Each tab's query key + the API call that bypasses the route's server cache.
const REFRESH: Record<TabKey, { key: readonly unknown[]; url: string }> = {
  campaigns: { key: ["brevo-campaigns"], url: "/api/brevo/campaigns?fresh=1" },
  reports: { key: ["brevo-reports"], url: "/api/brevo/reports?fresh=1" },
  health: { key: ["brevo-health"], url: "/api/brevo/health?fresh=1" },
  automations: { key: ["brevo-automations"], url: "/api/brevo/automations" },
  audience: { key: ["brevo-audience"], url: "/api/brevo/audience" },
  coupons: { key: ["brevo-coupons"], url: "/api/brevo/coupons" },
  sms: { key: ["brevo-sms"], url: "/api/brevo/sms" },
};

export default function BrevoEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="pm2-body">
          <div className="pm2-skel" />
        </div>
      }
    >
      <BrevoEmailInner />
    </Suspense>
  );
}

function BrevoEmailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const raw = params.get("tab");
  const tab: TabKey = raw && TAB_KEYS.has(raw) ? (raw as TabKey) : "campaigns";
  const rawPeriod = params.get("period");
  const period: Period = rawPeriod === "7d" || rawPeriod === "90d" ? rawPeriod : "30d";
  const [refreshing, setRefreshing] = useState(false);

  const setParam = useCallback(
    (k: string, v: string | null) => {
      const q = new URLSearchParams(params.toString());
      if (v == null) q.delete(k);
      else q.set(k, v);
      router.replace(`/dashboard/marketing/email${q.toString() ? `?${q}` : ""}`);
    },
    [router, params],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = REFRESH[tab];
      // Warm the server cache with fresh data, then refetch the tab's queries.
      // Only the cached routes take ?fresh=1; the rest are always live.
      if (r.url.includes("fresh=1")) {
        const url = tab === "reports" ? `${r.url}&days=${period.replace("d", "")}` : r.url;
        await getJson(url).catch(() => null);
      }
      await qc.invalidateQueries({ queryKey: r.key });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <PageHeader
        crumb="Marketing · Email (Brevo)"
        title="Email"
        tabs={TABS}
        activeTab={tab}
        onTab={(k) => setParam("tab", k === "campaigns" ? null : k)}
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="pm2-btn sm" disabled={refreshing} onClick={refresh}>
              <RefreshCw size={14} /> Refresh
            </button>
            <a className="pm2-btn pri sm" href={BREVO_URL} target="_blank" rel="noreferrer">
              Open Brevo <ExternalLink size={14} />
            </a>
          </div>
        }
      />
      <div className="pm2-body">
        {tab === "campaigns" && <CampaignsTab />}
        {tab === "reports" && <ReportsTab period={period} onPeriod={(p) => setParam("period", p === "30d" ? null : p)} />}
        {tab === "automations" && <AutomationsTab />}
        {tab === "audience" && <AudienceTab />}
        {tab === "coupons" && <CouponsTab />}
        {tab === "sms" && <SmsTab />}
        {tab === "health" && <HealthTab />}
      </div>
    </>
  );
}
