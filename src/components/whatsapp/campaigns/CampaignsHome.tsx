"use client";

// WhatsApp marketing home (Campaigns tab): status strip, searchable campaign
// list with status filters and per-row actions, and folded-away audience
// insights. Creating/editing happens on the full-page wizard.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Callout, Chips } from "@/components/pm";
import { GlossaryTerm } from "@/components/guide";
import { errorMessage, useCampaigns } from "./api";
import { AudienceInsights } from "./AudienceInsights";
import { CampaignRow } from "./CampaignRow";
import { descendantCount, filterJourneyList } from "./journey";
import { LIST_FILTERS, matchesListFilter, matchesSearch, type ListFilter } from "./logic";
import { StatusStrip } from "./StatusStrip";
import { useCampaignActions } from "./useCampaignActions";
import s from "./campaigns.module.css";

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

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className={s.toolbar}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontFamily: "var(--pm-display)" }}>Campaigns</h2>
          <div className={s.help}>
            A campaign sends one approved <GlossaryTerm k="template">template</GlossaryTerm> to a group of customers, plus optional{" "}
            <GlossaryTerm k="followup">follow-ups</GlossaryTerm> later. Meta charges only for <GlossaryTerm k="delivered">delivered</GlossaryTerm> messages.
          </div>
        </div>
        <Link href={NEW_CAMPAIGN_HREF} className="pm2-btn pri">
          <Plus size={15} aria-hidden /> New campaign
        </Link>
      </div>

      <StatusStrip />

      <div className={s.toolbar}>
        <div className={s.searchBox}>
          <Search aria-hidden />
          <input
            className={s.input}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns or templates"
            aria-label="Search campaigns"
          />
        </div>
        <Chips
          ariaLabel="Filter campaigns by status"
          items={LIST_FILTERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key] }))}
          value={filter}
          onChange={(k) => setFilter(k as ListFilter)}
        />
      </div>

      {q.isError && (
        <Callout
          tone="crit"
          title="Couldn't load campaigns"
          body={errorMessage(q.error)}
          action={<button type="button" className="pm2-btn sm pri" onClick={() => q.refetch()}>Try again</button>}
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
          action={<Link href={NEW_CAMPAIGN_HREF} className="pm2-btn sm pri"><Plus size={14} aria-hidden /> Send your first campaign</Link>}
        />
      )}
      {!q.isLoading && list.length > 0 && shown.length === 0 && (
        <div className="pm2-empty">No campaigns match. Clear the search or pick another filter.</div>
      )}

      <div className={s.list}>
        {shown.map(({ item: c, depth }) => (
          <div key={c.id} className={depth > 0 ? s.fuChild : undefined} style={depth > 1 ? { marginLeft: 22 * depth } : undefined}>
            <CampaignRow c={c} run={run} busy={busy} />
          </div>
        ))}
      </div>

      <AudienceInsights />
      {dialog}
    </div>
  );
}
