"use client";

// Voice tab: the Sarvam voice-agent calls (cart rescue and COD order
// confirmation), in one place. Settings live in the Automations tab
// (wa_flow_settings voice flags); this tab shows the actual calls, with
// transcripts, recordings and a manual backfill from Sarvam's analytics API
// (voice-calls/sync) because Sarvam's post-call webhook is not currently
// reaching us — every voice_calls row otherwise sits on 'dialing' forever.
//
// Layout: takeaway + refresh, the voice agent tracker (scorecards, trend,
// reasons), then the latest calls. A row opens the call drawer.

import { useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, ChevronRight, Info, PhoneOff, RefreshCw, Search, ShoppingCart } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { PageHeader, PeriodPicker } from "@/components/pm";
import { HeaderMenu } from "@/components/inbox/HeaderMenu";
import { WaHeaderContext } from "./WaHeader";
import { apiFetch } from "@/lib/api-fetch";
import { timeAgo } from "@/app/dashboard/whatsapp/format";
import type { Stats, SyncResult, VoiceCall } from "./voice/model";
import {
  OUTCOME_OPTIONS, STATUS_OPTIONS, callResult, callSubject, displayName, fmtDur, fmtInr, groupTries, outcomeLabel,
  pct, scoreJob, statusLabel, triesKey,
} from "./voice/model";
import { VoiceTracker } from "./voice/VoiceTracker";
import { VOICE_PERIODS, VoiceKpis } from "./voice/VoiceKpis";
import type { VoicePeriod } from "@/lib/voice-summary";
import { CallDrawer } from "./voice/CallDrawer";
import s from "./voice.module.css";

function takeaway(calls: VoiceCall[]): string {
  if (!calls.length) return "No voice calls yet. Calls show here as soon as the agent places one.";
  const cod = scoreJob(calls.filter((c) => c.purpose === "cod_confirm"));
  const cart = scoreJob(calls.filter((c) => c.purpose === "cart"));
  const parts: string[] = [];
  if (cod.called) parts.push(`COD: ${cod.confirmed} of ${cod.called} calls confirmed, ${pct(cod.pickedUp, cod.called)}% picked up.`);
  if (cart.called) {
    parts.push(
      `Carts: ${cart.ordered ? `${cart.ordered} ordered after a call (${fmtInr(cart.orderedValue)})` : "no orders after a call yet"}, ${cart.linkSent} ${cart.linkSent === 1 ? "link" : "links"} sent.`,
    );
  }
  return parts.join(" ");
}

// The header sentence (cod-voice.html #or-calls), key numbers in bold.
function headline(calls: VoiceCall[]): ReactNode {
  if (!calls.length) return "No voice calls yet. Calls show here as soon as the agent places one.";
  const cod = scoreJob(calls.filter((c) => c.purpose === "cod_confirm"));
  const cart = scoreJob(calls.filter((c) => c.purpose === "cart"));
  return (
    <>
      The voice agent does two jobs.
      {cod.called > 0 && (
        <>
          {" "}<b>COD:</b> {pct(cod.confirmed, cod.called)}% of called orders confirmed, {cod.cancelled} cancelled on the call.
        </>
      )}
      {cart.called > 0 && (
        <>
          {" "}<b>Carts:</b>{" "}
          {cart.ordered ? (
            <>
              {cart.ordered} {cart.ordered === 1 ? "person" : "people"} bought after a call, <b>{fmtInr(cart.orderedValue)} back</b>.
            </>
          ) : (
            <>no orders after a call yet, {cart.linkSent} {cart.linkSent === 1 ? "link" : "links"} sent.</>
          )}
        </>
      )}
    </>
  );
}

// "Refresh call results": the manual Sarvam backfill. One definition, used by
// the page header (⋯ menu) and, until that header is wired, the body button.
function useVoiceSync() {
  const toast = useToast();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  async function handleSync() {
    setSyncing(true);
    try {
      const res = await apiFetch<SyncResult>("/api/whatsapp/voice-calls/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: 24 }),
      });
      // dndFailed means a do-not-call disposition could not be written to
      // wa_contacts - the sync route deliberately left that call row
      // retryable, but an operator must not read this as a clean success.
      toast.push({
        kind: res.dndFailed ? "error" : "success",
        text: `Call results refreshed. Checked ${res.scanned} calls, updated ${res.updated}${
          res.dndFlagged ? `, ${res.dndFlagged} marked "do not call"` : ""
        }${res.dndFailed ? `. ${res.dndFailed} could NOT be marked "do not call" yet; refresh again to retry` : ""}.`,
      });
      qc.invalidateQueries({ queryKey: ["voice-calls"] });
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Sync failed." });
    } finally {
      setSyncing(false);
    }
  }
  return { syncing, handleSync };
}

const unfilteredCalls = () => ({
  queryKey: ["voice-calls", "", "", ""],
  queryFn: () => apiFetch<{ calls: VoiceCall[]; stats: Stats }>("/api/whatsapp/voice-calls"),
  refetchInterval: 30_000,
});

// Page header for Orders & COD → Voice calls: eyebrow, VOICE CALLS, the
// results sentence, and "Refresh call results" in the ⋯ menu. Render it in
// the WhatsApp page header slot (VoiceView portals it there when one exists).
// With `period`, the 24h / 7d / 30d picker for the KPI strip sits beside it.
export function VoiceHeader({ period, onPeriod }: { period?: VoicePeriod; onPeriod?: (p: VoicePeriod) => void } = {}) {
  const { data, isLoading } = useQuery(unfilteredCalls());
  const { syncing, handleSync } = useVoiceSync();
  return (
    <PageHeader
      crumb="Orders & COD"
      title="Voice calls"
      summary={isLoading ? undefined : headline(data?.calls ?? [])}
      actions={
        <>
        {period && onPeriod && <PeriodPicker options={VOICE_PERIODS} value={period} onChange={onPeriod} ariaLabel="Totals period" />}
        <HeaderMenu
          label="More voice call actions"
          items={[
            {
              key: "sync",
              label: syncing ? "Refreshing…" : "Refresh call results",
              icon: <RefreshCw aria-hidden />,
              disabled: syncing,
              onSelect: handleSync,
            },
          ]}
        />
        </>
      }
    />
  );
}

export default function VoiceView({ headerInPage: headerProp = false }: { headerInPage?: boolean } = {}) {
  // When the WhatsApp page gives this tab a header slot (WaHeaderContext), the
  // full header (VoiceHeader) goes there and the body drops its own summary and
  // actions. Without a slot, the body keeps them so nothing is unreachable.
  const slotEl = useContext(WaHeaderContext)?.el ?? null;
  const headerInPage = headerProp || !!slotEl;
  const [status, setStatus] = useState("");
  const [outcome, setOutcome] = useState("");
  const [q, setQ] = useState("");
  const [purpose, setPurpose] = useState<"all" | "cart" | "cod_confirm">("all");
  const [period, setPeriod] = useState<VoicePeriod>("7d");
  const { syncing, handleSync } = useVoiceSync();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: flowsData } = useQuery({
    queryKey: ["wa-flows-settings", "voice"],
    queryFn: () => apiFetch<{ settings: { voice_call_enabled: boolean } }>("/api/whatsapp/flows"),
    staleTime: 30_000,
  });
  const voiceEnabled = flowsData?.settings?.voice_call_enabled ?? null;

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (outcome) p.set("outcome", outcome);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [status, outcome, q]);

  const { data, isLoading } = useQuery({
    queryKey: ["voice-calls", status, outcome, q],
    queryFn: () => apiFetch<{ calls: VoiceCall[]; stats: Stats }>(`/api/whatsapp/voice-calls${qs ? `?${qs}` : ""}`),
    refetchInterval: 30_000,
  });

  const allCalls = useMemo(() => data?.calls ?? [], [data]);
  const calls = purpose === "all" ? allCalls : allCalls.filter((c) => c.purpose === purpose);
  const stats = data?.stats ?? { placed: 0, connected: 0, linkSent: 0, doNotCall: 0, dialing: 0 };
  const hasFilters = !!(status || outcome || q.trim());
  const allStillDialing = calls.length > 0 && calls.every((c) => c.status === "dialing");
  const tries = useMemo(() => groupTries(allCalls), [allCalls]);
  const openCall = openId ? allCalls.find((c) => c.id === openId) ?? null : null;

  return (
    <div className={s.wrap}>
      {slotEl && createPortal(<VoiceHeader period={period} onPeriod={setPeriod} />, slotEl)}
      {headerInPage ? (
        <p className={s.sub}>
          {isLoading ? "Loading calls…" : hasFilters ? "Showing the calls that match your filters. " : ""}
          {stats.placed} calls loaded{hasFilters ? " (filtered)" : ""} · {stats.doNotCall} asked us not to call
          {stats.dialing > 0 ? ` · ${stats.dialing} result not in yet` : ""}
        </p>
      ) : (
        <div className={s.head}>
          <div className={s.headT}>
            <p className={s.sum}>{isLoading ? "Loading calls…" : hasFilters ? "Showing the calls that match your filters." : takeaway(allCalls)}</p>
            <p className={s.sub}>
              {stats.placed} calls loaded{hasFilters ? " (filtered)" : ""} · {stats.doNotCall} asked us not to call
              {stats.dialing > 0 ? ` · ${stats.dialing} result not in yet` : ""}
            </p>
          </div>
          <button type="button" className="pm2-btn" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={15} /> {syncing ? "Refreshing…" : "Refresh call results"}
          </button>
        </div>
      )}

      {!headerInPage && <PeriodPicker options={VOICE_PERIODS} value={period} onChange={setPeriod} ariaLabel="Totals period" />}
      <VoiceKpis period={period} />

      <details className={s.how}>
        <summary><Info size={14} /> How it works</summary>
        <p>
          A friendly AI voice calls customers who left a cart behind, and confirms COD orders that are still waiting on WhatsApp.
          Switch calls on or off, and set the calling hours, in the Automations tab.
        </p>
        <p>
          Calls are placed by our voice partner, Sarvam. Sarvam is meant to tell us how each call went as soon as it ends,
          but that message is not reaching us at the moment, so calls can stay on &quot;calling&quot;. &quot;Refresh call results&quot;
          asks Sarvam for the last 24 hours of results and updates the list. Anyone who asks us not to call is never called again.
        </p>
      </details>

      {voiceEnabled === false && (
        <p className={s.note}>
          <Info size={15} /> <span><b>Rescue calls are switched off.</b> The owner can turn them on in the Automations tab (Order messages, Voice rescue call). Past calls still show below.</span>
        </p>
      )}
      {allStillDialing && (
        <p className={s.note}>
          <Info size={15} /> <span>The results of these calls have not arrived yet. {headerInPage ? "Use Refresh call results in the ⋯ menu at the top to fetch them." : "Press Refresh call results above to fetch them."}</span>
        </p>
      )}

      {/* The list fetch is server-filtered, so scorecards built from it would
          only describe the matching calls (filter to "Picked up" and every
          rate reads ~100%). Hide them while a filter is on. */}
      {!isLoading && hasFilters ? (
        <p className={s.filteredNote}>
          Totals hidden while filtered ·{" "}
          <button type="button" className={s.txtBtn} onClick={() => { setStatus(""); setOutcome(""); setQ(""); }}>
            Clear filters
          </button>
        </p>
      ) : (
        !isLoading && allCalls.length > 0 && <VoiceTracker calls={allCalls} />
      )}

      <section className={s.card} aria-labelledby="vc-list-h">
        <div className={s.listH}>
          <h3 id="vc-list-h">Latest calls</h3>
          <div className={s.chips} role="group" aria-label="Call type">
            {([["all", "All"], ["cod_confirm", "COD"], ["cart", "Carts"]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`pm2-chip${purpose === v ? " on" : ""}`}
                aria-pressed={purpose === v}
                onClick={() => setPurpose(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={s.filters}>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={s.ctl}>
            <option value="">Any call status</option>
            {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{statusLabel(o)}</option>)}
          </select>
          <select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={s.ctl}>
            <option value="">Any outcome</option>
            {OUTCOME_OPTIONS.map((o) => <option key={o} value={o}>{outcomeLabel(o)}</option>)}
          </select>
          <label className={s.search}>
            <Search size={15} aria-hidden />
            <input aria-label="Search by number or name" placeholder="Search number or name" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        {isLoading ? (
          <p className={s.empty}>Loading…</p>
        ) : calls.length === 0 ? (
          <p className={s.empty}>{hasFilters || purpose !== "all" ? "No calls match these filters." : "No voice calls yet."}</p>
        ) : (
          <ul className={s.list}>
            {calls.map((c) => {
              const r = callResult(c);
              const group = tries.get(triesKey(c)) ?? [c];
              const tryNo = group.findIndex((x) => x.id === c.id) + 1;
              const meta = [callSubject(c), c.duration_s != null ? fmtDur(c.duration_s) : null, tryNo > 1 ? `try ${tryNo}` : null]
                .filter(Boolean).join(" · ");
              return (
                <li key={c.id}>
                  <button type="button" className={s.row} onClick={() => setOpenId(c.id)} aria-haspopup="dialog">
                    <span className={`${s.cj} ${c.purpose === "cod_confirm" ? s.icInfo : s.icGood}`} aria-hidden title={c.purpose === "cod_confirm" ? "COD" : "Cart"}>
                      {c.purpose === "cod_confirm" ? <Banknote size={16} /> : <ShoppingCart size={16} />}
                    </span>
                    <span className={s.rowM}>
                      <b>
                        {displayName(c)}
                        {c.contact.voice_dnd && <span className={s.dnd}><PhoneOff size={12} /> Do not call</span>}
                      </b>
                      <span>{meta}</span>
                    </span>
                    <span className={s.rowO}>
                      <span className={`${s.tg} ${s[r.tone]}`}>{r.label}</span>
                      <time dateTime={c.created_at}>{timeAgo(c.created_at)}</time>
                    </span>
                    <ChevronRight size={16} className={s.chev} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {openCall && (
        <CallDrawer call={openCall} tries={tries.get(triesKey(openCall)) ?? [openCall]} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
