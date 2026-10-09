"use client";

// Orders → Voice calls KPI strip (cod-voice.html #or-calls): one period's
// totals from GET /api/whatsapp/voice-calls/summary. Read-only.

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Kpi } from "@/components/pm";
import { apiFetch } from "@/lib/api-fetch";
import type { VoicePeriod, VoiceSummary } from "@/lib/voice-summary";
import { fmtInr, pct } from "./model";
import s from "../voice.module.css";

export const VOICE_PERIODS: readonly VoicePeriod[] = ["24h", "7d", "30d"];
const PERIOD_WORDS: Record<VoicePeriod, string> = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days" };

export function VoiceKpis({ period }: { period: VoicePeriod }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["voice-calls-summary", period],
    queryFn: () => apiFetch<{ summary: VoiceSummary; truncated: boolean }>(`/api/whatsapp/voice-calls/summary?period=${period}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  if (error) return <p className={s.filteredNote}>Totals could not load. The call list below is still up to date.</p>;
  const k = data?.summary;
  const v = (n: number | undefined) => (isLoading || n == null ? "–" : n.toLocaleString("en-IN"));
  const started = k ? k.calls - k.notStarted : 0;
  return (
    <div className={`pm2-kpis ${s.k6}`} aria-label={`Voice call totals, ${PERIOD_WORDS[period]}`}>
      <Kpi label="Calls" value={v(k?.calls)} sub={k ? `${PERIOD_WORDS[period]}${k.notStarted ? ` · ${k.notStarted} could not start` : ""}` : undefined} />
      <Kpi label="Reached" value={v(k?.reached)} sub={k ? `${pct(k.reached, started)}% picked up` : undefined} />
      <Kpi label={<span className={`${s.kDot} ${s.good}`}>Confirmed</span>} value={v(k?.confirmed)} sub="COD orders" />
      <Kpi label={<span className={`${s.kDot} ${s.bad}`}>Cancelled</span>} value={v(k?.cancelled)} sub="Asked to cancel" />
      <Kpi label="No answer" value={v(k?.noAnswer)} sub={k && k.waiting ? `${k.waiting} result not in yet` : "No answer or busy"} />
      <Kpi
        label="Success rate"
        value={isLoading || !k ? "–" : `${k.successRate}%`}
        sub={k && k.cartOrdered ? `incl. ${k.cartOrdered} carts, ${fmtInr(k.cartOrderedValue)}` : "Confirmed or ordered after"}
      />
    </div>
  );
}
