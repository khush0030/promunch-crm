"use client";

// B2B outreach: ONE path (owner approved Oct 10 2026).
//   Find -> Pick -> Write -> Approve -> Send (+ optional follow-ups) -> Replies
// Tabs are real URLs (?tab=), listed in the shell nav as the B2B section tabs:
// Find · Lists · Approve · Replies · Settings. A "where things are" strip sits
// on top of every tab. Finding runs on the server (pg_cron every 2 minutes);
// this page only polls the cheap /api/leads/status, so the tab can be closed.

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { PageHeader } from "@/components/pm";
import { useAccess } from "@/components/shell/useAccess";
import type { Stage } from "@/lib/leads/lead-status";
import StatusStrip, { type B2bTab } from "@/components/leads/StatusStrip";
import FindView from "@/components/leads/FindView";
import ListsView, { listName } from "@/components/leads/ListsView";
import ListDetail, { useList } from "@/components/leads/ListDetail";
import ApproveView from "@/components/leads/ApproveView";
import RepliesView from "@/components/leads/RepliesView";
import SettingsView from "@/components/leads/SettingsView";
import LeadDrawer from "@/components/leads/LeadDrawer";
import { nf, useB2bStatus } from "@/components/leads/api";
import b from "@/components/leads/b2b.module.css";

const TABS: B2bTab[] = ["find", "lists", "approve", "replies", "settings"];
// Old links keep working.
const ALIAS: Record<string, B2bTab> = { review: "approve", setup: "settings", overview: "lists" };

export default function LeadsPage() {
  return (
    <Suspense fallback={null}>
      <B2bPage />
    </Suspense>
  );
}

function B2bPage() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab") ?? "lists";
  const tab: B2bTab = (TABS as string[]).includes(raw) ? (raw as B2bTab) : ALIAS[raw] ?? "lists";
  const listId = tab === "lists" ? params.get("list") : null;
  const batchId = tab === "approve" ? params.get("batch") : null;
  const show = params.get("show");
  const view = params.get("view");

  const access = useAccess();
  const isAdmin = !!access?.admin;
  const statusQ = useB2bStatus();
  const status = statusQ.data;
  const settings = status?.settings ?? null;
  const c = status?.counts ?? {};
  const [openLead, setOpenLead] = useState<string | null>(null);
  const listQ = useList(listId);

  const go = useCallback((t: B2bTab, extra?: Record<string, string>) => {
    const q = new URLSearchParams();
    if (t !== "lists") q.set("tab", t);
    for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
    const qs = q.toString();
    router.push(`/dashboard/leads${qs ? `?${qs}` : ""}`);
  }, [router]);
  const openList = useCallback((id: string) => go("lists", { list: id }), [go]);

  // One clear next step.
  const waiting = c.drafted ?? 0;
  const ready = c.ready ?? 0;
  const replies = c.replied ?? 0;
  const next = settings?.paused
    ? <button type="button" className="pm-btn primary" onClick={() => go("settings")}>Turn sending back on</button>
    : waiting > 0
      ? <button type="button" className="pm-btn primary" onClick={() => go("approve")}>Approve {nf(waiting)} emails <ArrowRight /></button>
      : ready > 0
        ? <button type="button" className="pm-btn primary" onClick={() => go("lists", { show: "ready" })}>Pick who to email ({nf(ready)} ready) <ArrowRight /></button>
        : replies > 0
          ? <button type="button" className="pm-btn primary" onClick={() => go("replies")}>Read {nf(replies)} replies</button>
          : <button type="button" className="pm-btn primary" onClick={() => go("find")}><Search /> Find businesses</button>;

  const sender = settings?.from_name?.split(" ")[0] || "Parth";
  let header: { crumb: React.ReactNode; title: React.ReactNode; summary?: React.ReactNode; actions?: React.ReactNode };
  switch (tab) {
    case "find":
      header = {
        crumb: "B2B & deals",
        title: "Find businesses",
        summary: <>Pick a type and a city. We find them on Google Maps and check their websites for an email. <b>Nothing is written or sent from here.</b></>,
      };
      break;
    case "approve":
      header = {
        crumb: "B2B & deals",
        title: "Approve",
        summary: waiting > 0
          ? <>Read each email once. Approved emails go out a few at a time as {sender}. <b>{nf(waiting)} waiting.</b></>
          : <>Emails you asked for wait here. <b>All caught up.</b></>,
      };
      break;
    case "replies":
      header = {
        crumb: "B2B & deals",
        title: "Replies",
        summary: <>{nf((c.contacted ?? 0) + replies + (c.bounced ?? 0))} businesses emailed. <b>{nf(replies)} replied.</b> A reply stops any follow-ups.</>,
        actions: <Link href="/dashboard/deals" className="pm-btn">Deals <ArrowRight /></Link>,
      };
      break;
    case "settings":
      header = {
        crumb: "B2B & deals",
        title: "Settings",
        summary: <>Sending, daily limit, follow-ups and saved emails. Emails send as {settings?.from_name ?? "Parth from PROMUNCH"}.</>,
      };
      break;
    default:
      header = listId
        ? {
            crumb: <Link href="/dashboard/leads" className={b.back}><ArrowLeft size={15} aria-hidden /> Lists</Link>,
            title: listQ.data ? listName(listQ.data.list.name) : "List",
            summary: <>Tick businesses, then <b>Write emails</b> for the Ready ones. Nothing sends until you approve.</>,
            actions: next,
          }
        : {
            crumb: "B2B & deals",
            title: "B2B outreach",
            summary: <>Find businesses, pick who to email, approve, and it sends as {sender}. One list per search.</>,
            actions: (
              <>
                {next}
                <button type="button" className="pm-btn" onClick={() => go("find")}><Search /> Find</button>
              </>
            ),
          };
  }

  return (
    <div>
      <PageHeader crumb={header.crumb} title={header.title} summary={header.summary} actions={header.actions} />

      <div className={b.body} style={{ paddingBottom: 0 }}>
        <StatusStrip status={status} onGo={go} />
      </div>

      {tab === "find" && <FindView searches={status?.searches ?? []} onOpenList={openList} />}

      {tab === "lists" && !listId && (
        <ListsView
          searches={status?.searches ?? []}
          onOpen={openList}
          onFind={() => go("find")}
          onOpenList={openList}
          showReady={show === "ready"}
        />
      )}

      {tab === "lists" && listId && (
        <ListDetail
          key={listId}
          listId={listId}
          searches={status?.searches ?? []}
          settings={settings}
          isAdmin={isAdmin}
          initialStage={show === "ready" ? ("ready" as Stage) : null}
          onOpenLead={(l) => setOpenLead(l.id)}
          onApprove={(id) => go("approve", id ? { batch: id } : undefined)}
          onDeleted={() => go("lists")}
        />
      )}

      {tab === "approve" && (
        <ApproveView
          key={batchId ?? "all"}
          batchId={batchId}
          settings={settings}
          onBatch={(id) => go("approve", id ? { batch: id } : undefined)}
          onOpenLead={setOpenLead}
          onLists={() => go("lists")}
        />
      )}

      {tab === "replies" && (
        <RepliesView
          initialView={view === "contacted" || view === "bounced" ? view : null}
          counts={c}
          inFollowUps={status?.inFollowUps ?? 0}
          onOpenLead={(l) => setOpenLead(l.id)}
        />
      )}

      {tab === "settings" && <SettingsView settings={settings} sentToday={status?.sentToday ?? 0} isAdmin={isAdmin} />}

      {openLead && <LeadDrawer leadId={openLead} settings={settings} isAdmin={isAdmin} onClose={() => setOpenLead(null)} />}
    </div>
  );
}
