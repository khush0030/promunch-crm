"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/pm";
import AnalyticsView from "@/components/whatsapp/AnalyticsView";
import type { Tab } from "@/components/whatsapp/types";
import TemplatesView from "@/components/whatsapp/TemplatesView";
import KbView from "@/components/whatsapp/KbView";
import CampaignsView from "@/components/whatsapp/CampaignsView";
import FlowsView from "@/components/whatsapp/FlowsView";
import { WA_TAB_RESELECT } from "@/components/whatsapp/flows/context";
import VoiceView from "@/components/whatsapp/VoiceView";
import GrowthView from "@/components/whatsapp/GrowthView";
import StartHere from "@/components/whatsapp/home/StartHere";
import { HealthNotice } from "@/components/whatsapp/home/HealthNotice";
import { FLOWS_VISITED_KEY, setLocalFlag } from "@/components/whatsapp/home/useLocalFlag";
import h from "@/components/whatsapp/home/home.module.css";
import { WaHeaderContext, type WaHeaderSlot } from "@/components/whatsapp/WaHeader";
import { useAccess } from "@/components/shell/useAccess";
import { canUse, whatsappTabModule } from "@/lib/access";

// WhatsApp marketing hub. Chats and tickets moved to /dashboard/inbox
// (next.config.ts redirects ?tab=inbox / ?tab=tickets / no tab there), so they
// are not tabs here any more. Overview (?tab=home) is the landing tab.
// Tab keys never change (old links like ?tab=analytics keep working); only
// the labels are written for a marketer. Each tab renders its own header
// (components/whatsapp/WaHeader) into the slot above the body.
type PageTab = Exclude<Tab, "inbox" | "tickets"> | "home";
const ITEMS: Array<{ key: PageTab; label: string }> = [
  { key: "home", label: "Overview" },
  { key: "campaigns", label: "Campaigns" },
  { key: "templates", label: "Templates" },
  { key: "flows", label: "Automations" },
  { key: "analytics", label: "Results" },
  { key: "growth", label: "Signup popup" },
  { key: "voice", label: "Voice" },
  { key: "kb", label: "Bot knowledge" },
];
const TABS: PageTab[] = ITEMS.map((i) => i.key);

// Tabs that live in other sidebar places now: they keep their URL but show
// as a page of that place (its title and section tabs), not as a WhatsApp
// marketing tab.
const ELSEWHERE: Partial<Record<PageTab, { crumb: string; title: string; summary?: string }>> = {
  kb: { crumb: "Inbox", title: "Bot knowledge" },
  voice: { crumb: "Orders & COD", title: "Voice calls" },
  growth: {
    crumb: "Customers",
    title: "Sign-up popup",
    summary: "A small box on your website that invites visitors to join your WhatsApp list, plus a one-tap chat button.",
  },
};

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

  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  const onTab = useCallback((k: string) => {
    // Re-clicking the open tab returns it to its start (e.g. the
    // Automations list from an open automation). UI only.
    if (k === tab) window.dispatchEvent(new CustomEvent(WA_TAB_RESELECT, { detail: k }));
    setTab(k as PageTab);
  }, [tab, setTab]);
  const slot = useMemo<WaHeaderSlot>(() => ({
    el: slotEl,
    tabs: ITEMS.filter((it) => allowedTabs.includes(it.key) && !ELSEWHERE[it.key]),
    activeTab: tab,
    onTab,
  }), [slotEl, allowedTabs, tab, onTab]);
  const elsewhere = ELSEWHERE[tab];

  return (
    <WaHeaderContext.Provider value={slot}>
      <div ref={tabsRef} className={h.tabsFade}>
        {elsewhere && tab !== "kb" && tab !== "voice" ? (
          <PageHeader crumb={elsewhere.crumb} title={elsewhere.title} summary={elsewhere.summary} />
        ) : (
          // Each marketing tab portals its own header (title, sentence,
          // action, tabs) in here. Voice calls and Bot knowledge portal their
          // own place's header (KbView/VoiceView) without the marketing tabs.
          <div ref={setSlotEl} />
        )}
      </div>
      <div className="pm2-body">
        {tab === "home" && <HealthNotice />}
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
    </WaHeaderContext.Provider>
  );
}
