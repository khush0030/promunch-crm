"use client";

// Template list grouped the way a marketer thinks about it:
//   For campaigns        marketing templates, full actions (primary)
//   Automatic messages   customer-service (utility) templates, read-only
//   Team alerts          internal system templates, collapsed, read-only

import { ChevronRight, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { GlossaryTerm, HelpTip } from "@/components/guide";
import { friendlyTemplateName, type TemplateKind } from "@/lib/whatsapp/templateKind";
import {
  STATUS_FILTERS, groupTemplates, matchesSearch, matchesStatus, statusInfo, type StatusFilter,
} from "@/lib/whatsapp/template-display";
import type { TemplateRow } from "./api";
import { TemplateCard } from "./TemplateCard";
import s from "./templates.module.css";

type CardHandlers = {
  onEdit: (t: TemplateRow) => void;
  onDuplicate: (t: TemplateRow) => void;
  onDelete: (t: TemplateRow) => void;
  onAttachMedia: (t: TemplateRow, url: string | null) => void;
};

function Cards({ items, kind, h }: { items: TemplateRow[]; kind: TemplateKind; h: CardHandlers }) {
  return (
    <div className={s.grid}>
      {items.map((t) => (
        <TemplateCard key={t.id} t={t} kind={kind} {...h} />
      ))}
    </div>
  );
}

function FirstTemplateEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className={s.empty}>
      <h3 className={s.emptyTitle}>No campaign templates yet</h3>
      <ul className={s.emptyList}>
        <li>
          A <GlossaryTerm k="template">template</GlossaryTerm> is a message you write once and Meta checks. After{" "}
          <GlossaryTerm k="approval">approval</GlossaryTerm> you can send it to many customers in a campaign.
        </li>
        <li>Start from a ready-made PROMUNCH message, change the words and add a picture. It takes about 5 minutes.</li>
        <li>Meta usually reviews it within minutes, sometimes up to 24 hours.</li>
      </ul>
      <button type="button" className="pm2-btn pri" onClick={onCreate}>
        <Plus aria-hidden="true" /> Create your first template
      </button>
    </div>
  );
}

export function TemplateList({
  list,
  loading,
  onCreate,
  ...h
}: {
  list: TemplateRow[];
  loading: boolean;
  onCreate: () => void;
} & CardHandlers) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const all = useMemo(() => groupTemplates(list), [list]);
  const shown = useMemo(() => {
    const f = (t: TemplateRow) => matchesStatus(t.status, status) && matchesSearch(t, search, friendlyTemplateName(t.name));
    return groupTemplates(list.filter(f));
  }, [list, search, status]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of STATUS_FILTERS) m[f] = list.filter((t) => matchesStatus(t.status, f)).length;
    return m;
  }, [list]);
  const filtering = search.trim() !== "" || status !== "all";

  return (
    <>
      <div className={s.filters}>
        <div className={s.searchBox}>
          <Search aria-hidden="true" />
          <input
            className={s.input}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates"
            aria-label="Search templates"
          />
        </div>
        <div className={s.chips} role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`pm2-chip ${status === f ? "on" : ""}`}
              aria-pressed={status === f}
              onClick={() => setStatus(f)}
            >
              {f === "all" ? "All" : statusInfo(f).label}
              <em>{counts[f] ?? 0}</em>
            </button>
          ))}
        </div>
      </div>

      {/* For campaigns */}
      <section className={s.group} aria-labelledby="tpl-g-mkt">
        <div className={s.groupHead}>
          <h2 id="tpl-g-mkt" className={s.groupTitle}>For campaigns</h2>
          <span className={s.groupCount}>{shown.marketing.length}</span>
          <HelpTip term="marketing" />
          <p className={s.groupSub}>
            <GlossaryTerm k="marketing">Marketing</GlossaryTerm> templates you can send to customers in a campaign once they show Approved.
          </p>
        </div>
        {!loading && all.marketing.length === 0 ? (
          <FirstTemplateEmpty onCreate={onCreate} />
        ) : shown.marketing.length === 0 && !loading ? (
          <div className="pm2-empty">No campaign templates match {filtering ? "your search or filter" : "yet"}.</div>
        ) : (
          <Cards items={shown.marketing} kind="marketing" h={h} />
        )}
      </section>

      {/* Automatic messages */}
      {all.customer_service.length > 0 && (
        <details className={`${s.group} ${s.fold}`} open>
          <summary>
            <ChevronRight aria-hidden="true" />
            <h2 className={s.groupTitle}>Automatic messages</h2>
            <span className={s.groupCount}>{shown.customer_service.length}</span>
            <span className={s.groupSub}>
              Sent automatically by Automations, for example order updates. These are{" "}
              <GlossaryTerm k="utility">utility</GlossaryTerm> messages, so they can&apos;t be used in campaigns.
            </span>
          </summary>
          <div className={s.foldBody}>
            {shown.customer_service.length ? (
              <Cards items={shown.customer_service} kind="customer_service" h={h} />
            ) : (
              <div className="pm2-empty">Nothing matches your search or filter.</div>
            )}
          </div>
        </details>
      )}

      {/* Team alerts */}
      {all.internal.length > 0 && (
        <details className={`${s.group} ${s.fold}`} open={(filtering && shown.internal.length > 0) || undefined}>
          <summary>
            <ChevronRight aria-hidden="true" />
            <h2 className={s.groupTitle}>Team alerts</h2>
            <span className={s.groupCount}>{shown.internal.length}</span>
            <span className={s.groupSub}>System messages for the PROMUNCH team and order confirmations. View only, never edit or delete these.</span>
          </summary>
          <div className={s.foldBody}>
            {shown.internal.length ? (
              <Cards items={shown.internal} kind="internal" h={h} />
            ) : (
              <div className="pm2-empty">Nothing matches your search or filter.</div>
            )}
          </div>
        </details>
      )}
    </>
  );
}
