"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/pm";
import AnalyticsView from "@/components/whatsapp/AnalyticsView";
import type { Tab } from "@/components/whatsapp/types";
import TemplatesView from "@/components/whatsapp/TemplatesView";
import KbView from "@/components/whatsapp/KbView";
import CampaignsView from "@/components/whatsapp/CampaignsView";
import FlowsView from "@/components/whatsapp/FlowsView";
import VoiceView from "@/components/whatsapp/VoiceView";
import GrowthView from "@/components/whatsapp/GrowthView";
import StartHere from "@/components/whatsapp/home/StartHere";
import { HealthNotice } from "@/components/whatsapp/home/HealthNotice";
import { FLOWS_VISITED_KEY, setLocalFlag } from "@/components/whatsapp/home/useLocalFlag";
import h from "@/components/whatsapp/home/home.module.css";
import { useAccess } from "@/components/shell/useAccess";
import { canUse, whatsappTabModule } from "@/lib/access";

// WhatsApp marketing hub. Chats and tickets moved to /dashboard/inbox
// (next.config.ts redirects ?tab=inbox / ?tab=tickets / no tab there), so they
// are not tabs here any more. "Start here" (?tab=home) is the landing tab.
// Tab keys never change (old links like ?tab=analytics keep working); only
// the labels are written for a marketer.
type PageTab = Exclude<Tab, "inbox" | "tickets"> | "home";
const ITEMS: Array<{ key: PageTab; label: string }> = [
  { key: "home", label: "Start here" },
  { key: "campaigns", label: "Campaigns" },
  { key: "templates", label: "Message templates" },
  { key: "flows", label: "Automations" },
  { key: "analytics", label: "Results" },
  { key: "growth", label: "Signup popup" },
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
  const tab: PageTab = urlTab && TABS.includes(urlTab) ? urlTab : "home";
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

  // "Review your automations" on Start here ticks itself once they've looked.
  useEffect(() => {
    if (tab === "flows" && tabAllowed) setLocalFlag(FLOWS_VISITED_KEY);
  }, [tab, tabAllowed]);

  // On a phone the tab strip scrolls sideways: keep the current tab in view.
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = tabsRef.current?.querySelector<HTMLElement>(".pm2-tabs button.on");
    const strip = on?.parentElement;
    if (on && strip && strip.scrollWidth > strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, on.offsetLeft - 24), behavior: "smooth" });
    }
  }, [tab, allowedTabs.length]);

  return (
    <>
      <div ref={tabsRef} className={h.tabsFade}>
        <PageHeader
          crumb="Marketing · WhatsApp"
          title="WhatsApp marketing"
          tabs={ITEMS.filter((it) => allowedTabs.includes(it.key))}
          activeTab={tab}
          onTab={(k) => setTab(k as PageTab)}
        />
      </div>
      <div className="pm2-body">
        <HealthNotice />
        {tabAllowed && <div>
          {tab === "home" && <StartHere />}
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
