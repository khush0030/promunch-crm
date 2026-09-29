"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/pm";
import AnalyticsView from "@/components/whatsapp/AnalyticsView";
import { timeAgo } from "./format";
import type { Tab } from "@/components/whatsapp/types";
import { WA_GREEN } from "@/components/whatsapp/styles";
import TemplatesView from "@/components/whatsapp/TemplatesView";
import KbView from "@/components/whatsapp/KbView";
import CampaignsView from "@/components/whatsapp/CampaignsView";
import FlowsView from "@/components/whatsapp/FlowsView";
import VoiceView from "@/components/whatsapp/VoiceView";
import GrowthView from "@/components/whatsapp/GrowthView";
import { useAccess } from "@/components/shell/useAccess";
import { canUse, whatsappTabModule } from "@/lib/access";

// WhatsApp marketing hub. Chats and tickets moved to /dashboard/inbox
// (next.config.ts redirects ?tab=inbox / ?tab=tickets / no tab there), so they
// are not tabs here any more.
type PageTab = Exclude<Tab, "inbox" | "tickets">;
const ITEMS: Array<{ key: PageTab; label: string }> = [
  { key: "campaigns", label: "Campaigns" },
  { key: "templates", label: "Templates" },
  { key: "flows", label: "Automations" },
  { key: "analytics", label: "Analytics" },
  { key: "growth", label: "Popup" },
  { key: "voice", label: "Voice" },
  { key: "kb", label: "Bot knowledge" },
];
const TABS: PageTab[] = ITEMS.map((i) => i.key);

// useSearchParams needs a Suspense boundary in the App Router.
export default function WhatsAppPage() {
  return (
    <Suspense fallback={<div className="pm2-body"><div className="pm2-skel" /></div>}>
      <WhatsAppPageInner />
    </Suspense>
  );
}

function WhatsAppPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const urlTab = params.get("tab") as PageTab | null;
  const tab: PageTab = urlTab && TABS.includes(urlTab) ? urlTab : "campaigns";
  // Tabs outside this teammate's areas are hidden (the middleware refuses
  // them too). Null while access loads: nothing renders yet.
  const access = useAccess();
  const allowedTabs = useMemo(() => TABS.filter((t) => access && canUse(access, whatsappTabModule(t))), [access]);
  const tabAllowed = allowedTabs.includes(tab);

  const setTab = useCallback((t: PageTab) => {
    router.replace(`/dashboard/whatsapp?tab=${t}`);
  }, [router]);

  // Landed on a tab they can't use (old link): hop to one they can.
  useEffect(() => {
    if (access && !tabAllowed && allowedTabs.length) setTab(allowedTabs[0]);
  }, [access, tabAllowed, allowedTabs, setTab]);

  return (
    <>
      <PageHeader
        crumb="Marketing · WhatsApp"
        title="WhatsApp marketing"
        tabs={ITEMS.filter((it) => allowedTabs.includes(it.key))}
        activeTab={tab}
        onTab={(k) => setTab(k as PageTab)}
      />
      <div className="pm2-body">
        <StatusMeter />
        {tabAllowed && <div>
          {tab === "templates" && <TemplatesView />}
          {tab === "campaigns" && <CampaignsView />}
          {tab === "flows" && <FlowsView />}
          {tab === "voice" && <VoiceView />}
          {tab === "growth" && <GrowthView />}
          {tab === "analytics" && <AnalyticsView />}
          {tab === "kb" && <KbView />}
        </div>}
      </div>
    </>
  );
}

/* WhatsApp uptime / health meter — polls /api/whatsapp/health every 30s.
   Collapsed to a single status pill above the inbox; click to expand the
   full uptime detail. */
function StatusMeter() {
  const [h, setH] = useState<any>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whatsapp/health");
      setH(await r.json());
    } catch { /* keep last good reading */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const status: string = h?.status ?? "unknown";
  const dot = status === "up" ? WA_GREEN : status === "down" ? "var(--pm-terra)" : "var(--pm-hint)";
  const failed: number = h?.failedOutbound24h ?? 0;
  const statusLabel = status === "up" ? "Operational" : status === "down" ? "Down" : "Unknown";

  const cells: Array<{ label: string; value: string; color?: string; dot?: boolean }> = [
    { label: "Cloud API", dot: true, color: dot,
      value: statusLabel },
    { label: "Uptime 24h", value: h?.uptime24h != null ? `${h.uptime24h}%` : "—" },
    { label: "Uptime 7d", value: h?.uptime7d != null ? `${h.uptime7d}%` : "—" },
    { label: "Last message in", value: timeAgo(h?.lastInboundAt ?? null) },
    { label: "Outbound 24h", value: failed > 0 ? `${failed} failed` : "OK",
      color: failed > 0 ? "var(--pm-terra)" : WA_GREEN },
    { label: "AI replies 24h", value: String(h?.aiReplies24h ?? 0) },
  ];

  return (
    <div style={{ margin: "-4px 0 0" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Hide health detail" : "Show health detail"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "var(--pm-card)", border: "1px solid var(--pm-border)",
          borderRadius: 999, padding: "6px 13px", fontSize: 13, fontWeight: 600,
          color: "var(--pm-ink)", cursor: "pointer",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, display: "inline-block" }} />
        WhatsApp · {statusLabel}
        {failed > 0 && (
          <span style={{ color: "var(--pm-terra)", fontWeight: 600 }}>· {failed} failed</span>
        )}
        <ChevronDown
          size={13}
          style={{
            color: "var(--pm-hint)", transition: "transform .15s",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>
      {open && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {cells.map((c) => (
            <div key={c.label} style={{
              flex: "1 1 120px", background: "var(--pm-card)", border: "1px solid var(--pm-border)",
              borderRadius: 10, padding: "9px 12px",
            }}>
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 3, display: "flex", alignItems: "center", gap: 5 }}>
                {c.dot && <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, display: "inline-block" }} />}
                {c.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.color ?? "var(--pm-ink)" }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


