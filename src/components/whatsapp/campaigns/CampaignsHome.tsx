"use client";

// WhatsApp marketing home (Campaigns tab): status strip, a calm searchable
// campaign table with status filters and per-row actions (in a small menu),
// and folded-away audience insights. Creating/editing happens on the full-page wizard.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Callout, Chips } from "@/components/pm";
import { errorMessage, useCampaignAnalytics, useCampaigns } from "./api";
import { AudienceInsights } from "./AudienceInsights";
import { CampaignRow } from "./CampaignRow";
import { descendantCount, filterJourneyList } from "./journey";
import { LIST_FILTERS, matchesListFilter, matchesSearch, type ListFilter } from "./logic";
import { StatusStrip } from "./StatusStrip";
import { WaHeader } from "../WaHeader";
import { useCampaignActions } from "./useCampaignActions";
import s from "./campaigns.module.css";
import l from "./list.module.css";

export const NEW_CAMPAIGN_HREF = "/dashboard/whatsapp/campaigns/new";

export default function CampaignsHome() {
  const q = useCampaigns();
  const { run, dialog, busy } = useCampaignActions({ followupCount: (c) => descendantCount(q.data ?? [], c.id) });
  const [filter, setFilter] = useState<ListFilter>("all");
  const [search, setSearch] = useState("");

  const list = useMemo(() => q.data ?? [], [q.data]);
  const counts = useMemo(
    () => Object.fromEntries(LIST_FILTERS.map((f) => [f.key, list.filter((c) => matchesListFilter(c.status, f.key)).length])),
    [list],
  );
  // Follow-ups sit under their parent; a match anywhere keeps the journey
  // (with the parents a matching follow-up hangs from).
  const shown = filterJourneyList(list, (c) => matchesListFilter(c.status, filter) && matchesSearch(c, search));

  // Revenue per campaign, from the same read-only analytics the campaign page
  // and Start here use (orders attributed within the campaign window).
  const anySent = list.some((c) => (c.sent_count ?? 0) > 0);
  const analytics = useCampaignAnalytics(365, anySent);
  const revenueById = useMemo(
    () => new Map((analytics.data?.campaigns ?? []).map((a) => [a.id, a.revenue] as const)),
    [analytics.data],
  );
  const nameById = useMemo(() => new Map(list.map((c) => [c.id, c.name] as const)), [list]);
  const campaignName = (id: string) => nameById.get(id);

  const summary = [
    counts.sending ? `${counts.sending} sending` : "",
    counts.scheduled ? `${counts.scheduled} scheduled` : "",
    counts.paused ? `${counts.paused} paused` : "",
    counts.draft ? `${counts.draft} ${counts.draft === 1 ? "draft" : "drafts"}` : "",
  ].filter(Boolean);

  return (
    <div className={l.wrap}>
      <WaHeader
        title="Campaigns"
        summary={<>One message to many people.{summary.length ? ` ${summary.join(", ")}.` : ""}</>}
        actions={
          <Link href={NEW_CAMPAIGN_HREF} className="pm2-btn pri">
            <Plus size={15} aria-hidden /> New campaign
          </Link>
        }
      />

      <StatusStrip />

      <div className={l.bar}>
        <div className={l.chipsWrap}>
          <Chips
            ariaLabel="Filter campaigns by status"
            items={LIST_FILTERS.map((f) => ({
              key: f.key,
              label: f.label,
              count: f.key === "all" ? undefined : counts[f.key],
            }))}
            value={filter}
            onChange={(k) => setFilter(k as ListFilter)}
          />
        </div>
        <div className={l.search}>
          <Search aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns or templates"
            aria-label="Search campaigns"
          />
        </div>
      </div>

      {q.isError && (
        <Callout
          tone="crit"
          title="Couldn't load campaigns"
          body={errorMessage(q.error)}
          action={<button type="button" className="pm2-btn sm" onClick={() => q.refetch()}>Try again</button>}
        />
      )}
      {q.isLoading && <div className="pm2-skel" aria-label="Loading campaigns" />}

      {!q.isLoading && !q.isError && list.length === 0 && (
        <Callout
          tone="plain"
          title="No campaigns yet. Here is how it works"
          body={
            <ol className={s.emptySteps}>
              <li>Pick an approved marketing message (a template).</li>
              <li>Fill in its blanks, like the offer or the picture.</li>
              <li>Choose who gets it. Warm is the safe choice.</li>
              <li>Send now or pick a time.</li>
              <li>Send yourself a test, then launch. You can pause any time.</li>
            </ol>
          }
          action={<Link href={NEW_CAMPAIGN_HREF} className="pm2-btn sm"><Plus size={14} aria-hidden /> Send your first campaign</Link>}
        />
      )}
      {!q.isLoading && list.length > 0 && shown.length === 0 && (
        <div className="pm2-empty">No campaigns match. Clear the search or pick another filter.</div>
      )}

      {shown.length > 0 && (
        <div className={l.card}>
          <table className={l.tbl}>
            <thead>
              <tr>
                <th scope="col">Campaign</th>
                <th scope="col">Status</th>
                <th scope="col" className={l.r}>Reached</th>
                <th scope="col" className={l.r}>Read</th>
                <th scope="col" className={l.r}>Revenue</th>
                <th scope="col" className={l.end}><span className="pm2-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ item: c, depth }) => (
                <CampaignRow
                  key={c.id}
                  c={c}
                  run={run}
                  busy={busy}
                  depth={depth}
                  revenue={revenueById.get(c.id) ?? null}
                  campaignName={campaignName}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AudienceInsights />
      {dialog}
    </div>
  );
}
