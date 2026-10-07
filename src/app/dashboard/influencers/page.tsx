"use client";

// Influencer delivery tracker. Barter collabs from "agreed" to "posted":
// brief, box, draft, post. Tabs and the open collab live in the URL
// (?tab=board|creators|kits|settings, ?deal=<id>) so any view can be shared.

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHead, Tabs } from "@/components/pm";
import { AddCollabDrawer } from "./_components/AddCollabDrawer";
import { BoardTab } from "./_components/BoardTab";
import { CreatorsTab } from "./_components/CreatorsTab";
import { DealDrawer } from "./_components/DealDrawer";
import { KitsTab } from "./_components/KitsTab";
import { SettingsTab } from "./_components/SettingsTab";

type TabKey = "board" | "creators" | "kits" | "settings";
const TABS: { key: TabKey; label: string }[] = [
  { key: "board", label: "Board" },
  { key: "creators", label: "Creators" },
  { key: "kits", label: "Kits" },
  { key: "settings", label: "Settings" },
];

function parseTab(v: string | null): TabKey {
  return TABS.some((t) => t.key === v) ? (v as TabKey) : "board";
}

export default function InfluencersPage() {
  return (
    <Suspense fallback={<div className="pm-page" />}>
      <InfluencersInner />
    </Suspense>
  );
}

function InfluencersInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const dealId = params.get("deal");
  const [adding, setAdding] = useState(false);

  const setQuery = useCallback(
    (next: { tab?: TabKey; deal?: string | null }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.tab !== undefined) {
        if (next.tab === "board") sp.delete("tab");
        else sp.set("tab", next.tab);
      }
      if (next.deal !== undefined) {
        if (next.deal) sp.set("deal", next.deal);
        else sp.delete("deal");
      }
      const qs = sp.toString();
      router.replace(`/dashboard/influencers${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const openDeal = useCallback((id: string) => setQuery({ deal: id }), [setQuery]);
  const closeDeal = useCallback(() => setQuery({ deal: null }), [setQuery]);
  const closeAdd = useCallback(() => setAdding(false), []);

  return (
    <div className="pm-page">
      <PageHead
        title="Influencers"
        subtitle="Barter collabs from agreed to posted: brief, box, draft and post, with reminders that keep creators on time."
        actions={
          <button type="button" className="pm-btn primary sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add collab
          </button>
        }
      />

      <Tabs tabs={TABS} active={tab} onSelect={(k) => setQuery({ tab: parseTab(k) })} />

      {tab === "board" && <BoardTab onOpenDeal={openDeal} onAdd={() => setAdding(true)} />}
      {tab === "creators" && <CreatorsTab onOpenDeal={openDeal} />}
      {tab === "kits" && <KitsTab />}
      {tab === "settings" && <SettingsTab />}

      {adding && (
        <AddCollabDrawer
          onClose={closeAdd}
          onCreated={(id) => {
            setAdding(false);
            openDeal(id);
          }}
        />
      )}
      {dealId && !adding && <DealDrawer key={dealId} dealId={dealId} onClose={closeDeal} />}
    </div>
  );
}
