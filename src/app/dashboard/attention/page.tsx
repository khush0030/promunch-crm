"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { PageHeader, Card, AttentionList, Callout } from "@/components/pm";
import { formatLakh } from "@/lib/metrics/money";
import type { Attention, AttentionGroup, AttentionItem } from "@/lib/metrics/attention";
import { useAttentionLocalState } from "./useAttentionLocalState";

const GROUPS: { key: AttentionGroup; label: string }[] = [
  { key: "money", label: "Money at risk" },
  { key: "customers", label: "Customers waiting" },
  { key: "marketing", label: "Marketing" },
];

function groupTitle(label: string, items: AttentionItem[]): string {
  const withAmount = items.filter((i) => i.amount != null);
  if (withAmount.length === 0) return label;
  const sum = withAmount.reduce((s, i) => s + (i.amount ?? 0), 0);
  return `${label} · ${formatLakh(sum)}`;
}

export default function AttentionPage() {
  const attentionQ = useQuery({
    queryKey: ["metrics-attention"],
    queryFn: async () => {
      const r = await fetch("/api/metrics/attention", { cache: "no-store" });
      if (!r.ok) throw new Error(`attention ${r.status}`);
      return (await r.json()) as Attention;
    },
  });

  const { view, setView, openItems, snoozedItems, doneItems, snoozeItem } = useAttentionLocalState(
    attentionQ.data?.items,
  );

  const openCount = openItems.length;
  const title = openCount === 0 ? "Nothing to decide" : `${openCount} to decide`;

  const header = (
    <PageHeader
      crumb="Today · Needs attention"
      title={title}
      actions={
        <span className="pm2-chips">
          <button type="button" className={`pm2-chip${view === "open" ? " on" : ""}`} onClick={() => setView("open")}>
            Open <em>{openCount}</em>
          </button>
          <button
            type="button"
            className={`pm2-chip${view === "snoozed" ? " on" : ""}`}
            onClick={() => setView("snoozed")}
          >
            Snoozed <em>{snoozedItems.length}</em>
          </button>
          <button type="button" className={`pm2-chip${view === "done" ? " on" : ""}`} onClick={() => setView("done")}>
            Done today <em>{doneItems.length}</em>
          </button>
        </span>
      }
    />
  );

  if (attentionQ.isLoading) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <div className="pm2-skel" />
          <div className="pm2-skel" />
          <div className="pm2-skel" />
        </div>
      </>
    );
  }

  if (attentionQ.isError || !attentionQ.data) {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Callout
            tone="crit"
            title="Couldn't load what needs attention"
            body={attentionQ.error instanceof Error ? attentionQ.error.message : "Something went wrong."}
            action={
              <button type="button" className="pm2-btn pri sm" onClick={() => attentionQ.refetch()}>
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  if (view === "done") {
    return (
      <>
        {header}
        <div className="pm2-body">
          <Card title="Done today" flush>
            {doneItems.length === 0 ? (
              <div style={{ color: "var(--pm-hint)", fontSize: 13, padding: "16px" }}>
                Nothing resolved yet today
              </div>
            ) : (
              <div className="pm2-done">
                {doneItems.map((d) => (
                  <div className="row" key={d.id}>
                    <CheckCircle2 size={16} />
                    <span>{d.title}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </>
    );
  }

  const activeItems = view === "open" ? openItems : snoozedItems;
  const emptyText = view === "open" ? "Nothing waiting on you right now" : "Nothing snoozed";

  const groupCards = GROUPS.map((g) => ({ ...g, items: activeItems.filter((i) => i.group === g.key) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <>
      {header}
      <div className="pm2-body">
        {groupCards.length === 0 ? (
          <Card flush>
            <div style={{ color: "var(--pm-hint)", fontSize: 13, padding: "16px" }}>{emptyText}</div>
          </Card>
        ) : (
          groupCards.map((g) => (
            <Card key={g.key} title={groupTitle(g.label, g.items)} flush>
              <AttentionList items={g.items} onSnooze={view === "open" ? snoozeItem : undefined} />
            </Card>
          ))
        )}
      </div>
    </>
  );
}
