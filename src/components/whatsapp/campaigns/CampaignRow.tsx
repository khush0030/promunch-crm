"use client";

// One campaign in the calm list table: name + a grey "when · who" line,
// status as coloured text with a dot, people reached, read %, revenue, then a
// more-actions menu and a chevron. At phone width the row becomes a two-line
// card (see list.module.css). Every action still goes through `run` exactly
// as before; this file only lays them out.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ChevronRight, Clock, MoreHorizontal, Repeat } from "lucide-react";
import type { Campaign } from "../types";
import { friendlyTemplateName } from "@/lib/whatsapp/templateKind";
import { useFailures } from "./api";
import { followupShortLabel, followupStatusMeta } from "./journey";
import { audienceFromFilter, fmtInr, fmtInt, fmtIst, pct, statusMeta, type CampaignAction } from "./logic";
import { ActionButtons, campaignHref } from "./useCampaignActions";
import { describeAudience } from "./wizard/StepReview";
import l from "./list.module.css";
import { useNow } from "./useNow";

// Meta #131049 holds, counted from the failure breakdown (loaded only for
// campaigns that have failures at all).
export function useHeldByMeta(c: Pick<Campaign, "id" | "failed_count" | "status">) {
  const q = useFailures(c.id, (c.failed_count ?? 0) > 0, c.status === "sending");
  if ((c.failed_count ?? 0) === 0) return 0;
  return q.data ? q.data.groups.filter((g) => g.key === "cap").reduce((a, g) => a + g.count, 0) : null;
}

const STATUS_CLASS: Record<string, string> = {
  sending: l.stSending,
  scheduled: l.stScheduled,
  draft: l.stDraft,
  paused: l.stPaused,
  failed: l.stFailed,
  completed: l.stSent,
  cancelled: l.stPlain,
};

export function StatusText({ status, followup = false, sent }: { status: string; followup?: boolean; sent?: number }) {
  const m = followup ? followupStatusMeta(status) : statusMeta(status);
  // "Sent" only when something actually went out; a finished campaign that
  // reached nobody (e.g. all held back by Meta) keeps main's "Completed".
  const label = status === "completed" && (sent ?? 0) > 0 ? "Sent" : m.label;
  return (
    <span className={`${l.status} ${STATUS_CLASS[status] ?? ""}`} title={m.hint || undefined}>
      {label}
    </span>
  );
}

// Short audience words for the grey line ("Warm", "Customer groups: VIP").
function audienceWords(c: Campaign, campaignName: (id: string) => string | undefined): string | null {
  if (c.followup_of) return null;
  if (!c.audience_filter) return null;
  const a = audienceFromFilter(c.audience_filter);
  const full = describeAudience(a, campaignName);
  if (a.mode === "warm" || a.mode === "engaged") return full.split(":")[0];
  return full;
}

function whenWords(c: Campaign): string {
  switch (c.status) {
    case "draft":
      return `Draft started ${fmtIst(c.created_at)}`;
    case "scheduled":
      return c.scheduled_at ? `Starts ${fmtIst(c.scheduled_at)}` : "Scheduled";
    case "sending":
      return `Started ${fmtIst(c.started_at ?? c.created_at)}`;
    case "paused":
      return c.paused_at ? `Paused ${fmtIst(c.paused_at)}` : "Paused";
    case "cancelled":
      return c.cancelled_at ? `Cancelled ${fmtIst(c.cancelled_at)}` : "Cancelled";
    case "failed":
      return `Stopped, started ${fmtIst(c.started_at ?? c.created_at)}`;
    default:
      // Nothing went out (e.g. all held back by Meta): don't say "Sent".
      return `${(c.sent_count ?? 0) > 0 ? "Sent" : "Finished"} ${fmtIst(c.started_at ?? c.created_at)}`;
  }
}

function Nil() {
  return <i className={l.nil} aria-label="none yet">–</i>;
}

export function CampaignRow({
  c,
  run,
  busy,
  depth = 0,
  revenue,
  campaignName,
}: {
  c: Campaign;
  run: (a: CampaignAction, c: Campaign) => void;
  busy: string | null;
  depth?: number;
  /** Attributed revenue from the campaign analytics, when known. */
  revenue?: number | null;
  campaignName: (id: string) => string | undefined;
}) {
  const held = useHeldByMeta(c);
  const now = useNow();
  const sent = c.sent_count ?? 0;
  const future = c.resume_at && Date.parse(c.resume_at) > now;
  // People actually reached (sent), never the planned audience: a finished
  // campaign where nothing went out must not read as delivered.
  const started = !["draft", "scheduled"].includes(c.status) || sent > 0;
  const people = started ? sent : null;
  const read = pct(c.read_count, sent);
  const tplName = c.template?.name ? friendlyTemplateName(c.template.name) : "No message picked yet";
  const who = audienceWords(c, campaignName);
  const isFu = !!c.followup_of;

  // A click anywhere on the row opens the campaign, unless it landed on a
  // control inside the row (links, the menu, its buttons).
  function onRowClick(e: MouseEvent<HTMLTableRowElement>) {
    if ((e.target as HTMLElement).closest("a,button,summary,[data-menu]")) return;
    run("open", c);
  }

  const peopleCell = people != null ? <span className={people > 0 ? l.num : l.zero}>{fmtInt(people)}</span> : <Nil />;
  const readCell = read != null ? <span className={l.num}>{read}%</span> : <Nil />;
  const revenueCell = revenue != null && (revenue > 0 || sent > 0) ? <b className={l.money}>{fmtInr(revenue)}</b> : <Nil />;

  return (
    <tr onClick={onRowClick}>
      <td className={l.main} style={depth > 0 ? { paddingLeft: 16 + 22 * depth } : undefined}>
        <div className={l.nameRow}>
          {depth > 0 && <span className={l.childMark} aria-hidden />}
          <Link href={campaignHref(c.id)} className={l.name}>
            {c.name}
          </Link>
        </div>
        {isFu && <span className={l.fu}>{followupShortLabel(c.followup_after_hours, c.followup_stage)}</span>}
        <span className={l.sub}>
          {whenWords(c)}
          {who ? ` · ${who}` : ""}
          {` · ${tplName}`}
          {held != null && held > 0 ? ` · ${fmtInt(held)} held back by Meta` : ""}
        </span>
        {isFu && c.status === "draft" && <span className={l.sub}>Turns on when the first message is launched</span>}
        {c.status === "scheduled" && c.repeat_rule && (
          <span className={l.sub}>
            <Repeat aria-hidden />
            Repeats {c.repeat_rule}
          </span>
        )}
        {c.status === "scheduled" && isFu && !c.scheduled_at && sent === 0 && (
          <span className={l.sub}>Waiting for people to reach their time</span>
        )}
        {c.status === "sending" && future && (
          <span className={l.sub}>
            <Clock aria-hidden />
            Next wave {fmtIst(c.resume_at)}
          </span>
        )}
      </td>
      <td className={l.meta}>
        <StatusText status={c.status} followup={isFu} sent={sent} />
      </td>
      <td className={`${l.meta} ${l.r}`}>{peopleCell}</td>
      <td className={`${l.meta} ${l.r}`}>{readCell}</td>
      <td className={`${l.meta} ${l.r}`}>{revenueCell}</td>
      <td className={l.metaLine}>
        <StatusText status={c.status} followup={isFu} sent={sent} />
        {people != null && (
          <span className={l.metaPart}><b>{fmtInt(people)}</b> <span>reached</span></span>
        )}
        {read != null && (
          <span className={l.metaPart}><b>{read}%</b> <span>read</span></span>
        )}
        {revenue != null && (revenue > 0 || sent > 0) && (
          <span className={l.metaPart}><b>{fmtInr(revenue)}</b></span>
        )}
      </td>
      <td className={l.end}>
        <span className={l.endIn}>
          <RowMenu c={c} run={run} busy={busy} />
          <Link href={campaignHref(c.id)} className={`${l.iconBtn} ${l.chevron}`} aria-label={`Open ${c.name}`} tabIndex={-1}>
            <ChevronRight aria-hidden />
          </Link>
        </span>
      </td>
    </tr>
  );
}

// Pause / resume / edit / duplicate / cancel / delete, folded into a small
// menu so the table stays calm. The buttons are the same ActionButtons the
// list always used, so each one calls `run` exactly as before.
function RowMenu({ c, run, busy }: { c: Campaign; run: (a: CampaignAction, c: Campaign) => void; busy: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={l.menuWrap} ref={ref} data-menu>
      <button
        type="button"
        className={l.iconBtn}
        aria-label={`More actions for ${c.name}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal aria-hidden />
      </button>
      {open && (
        // Closing after a pick: the click still reaches the action button first.
        <div className={l.menu} role="group" aria-label={`Actions for ${c.name}`} onClick={() => setOpen(false)}>
          <ActionButtons campaign={c} run={run} busy={busy} />
        </div>
      )}
    </span>
  );
}
