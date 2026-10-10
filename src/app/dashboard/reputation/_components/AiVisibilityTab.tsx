"use client";

// AI visibility: does an AI assistant name PROMUNCH when a shopper in India
// asks what to buy? Weekly run by the edge function ai-visibility-tick
// (OpenAI with web search, location India). Reads GET /api/orm/ai-visibility.
// Spec: docs/plans/2026-10-10-ai-visibility-phase2/AI_VISIBILITY_TRACKER.md.
//
//   1. Named in X of Y AI answers   share + trend over the last 12 runs
//   2. Which questions name us?     one row per shopping question
//   3. What does AI say about us?   the brand questions
//   4. Who gets named instead?      share of answers per brand

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useAccess } from "@/components/shell/useAccess";
import type { AiVisibilitySummary, BrandShare, PromptResult } from "@/lib/orm/ai-visibility";
import { api, errText, QK } from "./api";
import { LineChart, SrTable } from "./charts";
import { Mark, relTime, type Tone } from "./ui";
import s from "../reputation.module.css";

function useAiVisibility() {
  return useQuery({
    queryKey: QK.aiVisibility,
    queryFn: () => api<AiVisibilitySummary>("/api/orm/ai-visibility"),
    // poll while a run is going so the page fills in when it finishes
    refetchInterval: (q) => (q.state.data?.running ? 10_000 : 300_000),
  });
}

const pct = (v: number | null | undefined) => (v == null ? "" : `${Math.round(v * 100)}%`);

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function shareTone(share: number | null): Tone {
  if (share == null) return "neu";
  if (share === 0) return "crit";
  if (share < 0.25) return "warn";
  return "good";
}

function shareWord(share: number | null): string {
  if (share == null) return "No shopping answers";
  if (share === 0) return "Not named in any answer";
  if (share < 0.25) return "Rarely named";
  return "Named often";
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Readable answer: markdown links keep their text, bold/heading marks go. */
function readable(text: string | null): string {
  return (text ?? "")
    .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

export function AiVisibilityTab() {
  const q = useAiVisibility();
  const access = useAccess();
  const isAdmin = !!access?.admin;
  const data = q.data;

  if (q.isLoading) {
    return (
      <p className={s.hint} style={{ marginTop: 4 }}>
        Loading…
      </p>
    );
  }
  if (q.error || !data) {
    return (
      <div className={s.empty} style={{ marginTop: 0 }}>
        <span className={s.err} style={{ margin: 0 }}>
          {errText(q.error) ?? "Could not load AI visibility."}
        </span>
        <button type="button" className="pm-btn sm" onClick={() => q.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div style={{ opacity: q.isFetching && !q.isLoading && !data.running ? 0.7 : 1, transition: "opacity .15s" }}>
      {data.running && (
        <p className={s.aiRunning}>
          <Mark tone="info">Running now</Mark>
          <span>
            <b>
              {data.running.done} of {data.running.planned}
            </b>{" "}
            questions answered. Started {relTime(data.running.started_at)}. This page updates by itself.
          </span>
        </p>
      )}
      {!data.latest ? (
        <div className={s.empty} style={data.running ? undefined : { marginTop: 0 }}>
          <b>No results yet.</b>
          <span>
            Every Monday morning we ask an AI assistant {data.active_prompts} shopping questions, the way a shopper in
            India would, and check whether it names PROMUNCH.
            {data.running ? " The first run is going now." : isAdmin ? " Run it now to see where we stand today." : ""}
          </span>
          {isAdmin && !data.running && <RunNow />}
        </div>
      ) : (
        <Results data={data} isAdmin={isAdmin} />
      )}
    </div>
  );
}

function RunNow() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api<{ ok: boolean; run_id?: string }>("/api/orm/ai-visibility/run", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: QK.aiVisibility }),
  });
  return (
    <div className={s.aiRunRow}>
      <button type="button" className="pm-btn sm" onClick={() => m.mutate()} disabled={m.isPending}>
        <Play size={14} /> {m.isPending ? "Starting…" : "Run now"}
      </button>
      <span className={s.hint}>Takes 2 to 4 minutes and costs about $0.50 of OpenAI usage.</span>
      {m.error && <span className={s.err}>{errText(m.error)}</span>}
    </div>
  );
}

function Results({ data, isAdmin }: { data: AiVisibilitySummary; isAdmin: boolean }) {
  const latest = data.latest!;
  const shopping = data.prompts.filter((p) => p.kind === "category");
  const brandQs = data.prompts.filter((p) => p.kind === "brand");
  const trend = data.trend;

  return (
    <>
      <section className={s.q} style={{ borderTop: 0, paddingTop: 0, marginTop: data.running ? 22 : 0 }}>
        <div className={s.qHead}>
          <span className={s.qNum}>1</span>
          <div>
            <h2 className={s.qTitle}>
              Named in {latest.named} of {latest.total} AI answers
            </h2>
            <p className={s.qLead}>
              Shopping questions asked {relTime(latest.started_at)}, the way a shopper in India would. The AI could
              search the web, like ChatGPT does today.
            </p>
          </div>
        </div>
        <div className={s.hero}>
          <div className={s.heroMain}>
            <span className={s.kpiL}>Answers naming PROMUNCH</span>
            <div className={s.heroRow}>
              <span className={s.heroV}>{latest.share == null ? "None" : pct(latest.share)}</span>
            </div>
            <div className={s.heroMeta}>
              <Mark tone={shareTone(latest.share)}>{shareWord(latest.share)}</Mark>
              {latest.status === "partial" && <span className={s.t_warn}>Run stopped early</span>}
            </div>
            <p className={s.kpiD}>
              Share of shopping answers that mention PROMUNCH by name. The questions that ask about PROMUNCH directly
              are not counted here.
            </p>
            {isAdmin && !data.running && <RunNow />}
          </div>
          <div className={s.heroChart}>
            <span className={s.kpiL}>Share named, last {Math.max(trend.length, 1)} runs</span>
            {trend.length >= 2 ? (
              <LineChart
                ariaLabel="Share of AI answers naming PROMUNCH per run"
                points={trend.map((t) => ({
                  key: t.run_id,
                  label: dayLabel(t.started_at),
                  value: t.share == null ? null : Math.round(t.share * 100),
                  tip:
                    t.share == null
                      ? `${dayLabel(t.started_at)}: no answers`
                      : `${dayLabel(t.started_at)}: named in ${t.named} of ${t.total}`,
                }))}
                min={0}
                max={100}
                height={104}
                format={(v) => `${Math.round(v)}%`}
              />
            ) : (
              <p className={s.muted}>The trend line starts after the second run.</p>
            )}
          </div>
        </div>
      </section>

      <Section
        n={2}
        title="Which questions name us?"
        lead="Each shopping question, with every brand the answer named in order. Open one to read the full answer and the pages it used."
      >
        {shopping.length ? (
          <ul className={s.aiList}>
            {shopping.map((p) => (
              <PromptRow key={p.prompt_id ?? p.prompt} p={p} />
            ))}
          </ul>
        ) : (
          <p className={s.muted}>No shopping questions in this run.</p>
        )}
      </Section>

      {brandQs.length > 0 && (
        <Section
          n={3}
          title="What does AI say about PROMUNCH?"
          lead="Questions that ask about PROMUNCH by name. If it says it cannot find or verify us, it does not know us yet."
        >
          <ul className={s.aiList}>
            {brandQs.map((p) => (
              <PromptRow key={p.prompt_id ?? p.prompt} p={p} />
            ))}
          </ul>
        </Section>
      )}

      <Section
        n={brandQs.length > 0 ? 4 : 3}
        title="Who gets named instead?"
        lead="How many shopping answers named each brand. The 10 most named brands, plus PROMUNCH."
      >
        <ShareBars rows={data.competitors} total={latest.total} />
      </Section>

      <p className={s.aiFoot}>
        Last run {relTime(latest.finished_at ?? latest.started_at)}
        {latest.trigger === "manual" ? " (started by hand)" : ""}
        {latest.model ? `, asked with ${latest.model}` : ""}
        {latest.cost_usd != null ? `, cost about $${latest.cost_usd.toFixed(2)}` : ""}.
        {latest.errors > 0 && ` ${latest.errors} ${latest.errors === 1 ? "question" : "questions"} got no answer.`}
        {latest.error && ` ${latest.error}`}
        {" "}Runs every Monday morning.
      </p>
    </>
  );
}

function Section({ n, title, lead, children }: { n: number; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section className={s.q}>
      <div className={s.qHead}>
        <span className={s.qNum}>{n}</span>
        <div>
          <h2 className={s.qTitle}>{title}</h2>
          <p className={s.qLead}>{lead}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatusMark({ p }: { p: PromptResult }) {
  if (!p.answered) return <Mark tone="warn">No answer</Mark>;
  if (p.kind === "brand") {
    return p.recognised ? <Mark tone="good">Knows PROMUNCH</Mark> : <Mark tone="crit">Does not know PROMUNCH</Mark>;
  }
  if (p.named) {
    return <Mark tone="good">{p.rank ? `Named, brand ${p.rank} of ${p.brands.length}` : "Named"}</Mark>;
  }
  return <Mark tone="crit">Not named</Mark>;
}

function PromptRow({ p }: { p: PromptResult }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className={s.aiRowTop}>
        <b className={s.aiTopic}>{p.topic}</b>
        {p.from_audit && <span className={s.hint}>Audit question</span>}
        <span className={s.aiStatus}>
          <StatusMark p={p} />
        </span>
      </div>
      <p className={s.aiBrands}>
        {!p.answered
          ? p.error
          : p.brands.length
            ? `Names ${p.brands.join(", ")}`
            : "Names none of the brands we track."}
      </p>
      <button type="button" className={`${s.linkBtn} ${s.aiToggle}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide the answer" : p.answered ? "Read the answer" : "See the question"}
      </button>
      {open && (
        <div className={s.aiAnswer}>
          <p className={s.aiQ}>
            <span className={s.eyebrow}>Question</span>
            {p.prompt}
          </p>
          {p.answered && (
            <div>
              <span className={s.eyebrow}>Answer</span>
              <p className={s.fullText}>{readable(p.answer)}</p>
            </div>
          )}
          {p.citations.length > 0 && (
            <div>
              <span className={s.eyebrow}>Pages it used</span>
              <ul className={s.aiCites}>
                {p.citations.map((c) => (
                  <li key={c.url}>
                    <a href={c.url} target="_blank" rel="noopener noreferrer">
                      {c.title || host(c.url)}
                    </a>{" "}
                    <span className={s.hint}>{host(c.url)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.answered && !p.web_search && <p className={s.hint}>It answered without searching the web.</p>}
        </div>
      )}
    </li>
  );
}

function ShareBars({ rows, total }: { rows: BrandShare[]; total: number }) {
  if (!total || !rows.length) return <p className={s.muted}>No shopping answers in this run.</p>;
  const max = Math.max(1, ...rows.map((r) => r.answers));
  return (
    <>
      <ul className={s.aiBars} aria-hidden="true">
        {rows.map((r) => (
          <li key={r.brand} className={r.ours ? s.aiOurs : undefined} title={`${r.brand}: ${r.answers} of ${total} answers`}>
            <span className={s.aiBrand}>{r.brand}</span>
            <span className={s.mixTrack}>
              <span
                className={r.ours ? s.compBarOurs : s.compBar}
                style={{ width: r.answers ? `${(r.answers / max) * 100}%` : 0 }}
              />
            </span>
            <span className={s.aiCount}>
              {r.answers} of {total}
            </span>
          </li>
        ))}
      </ul>
      <SrTable
        caption="Shopping answers naming each brand"
        head={["Brand", "Answers", "Share"]}
        rows={rows.map((r) => [r.brand, `${r.answers} of ${total}`, pct(r.share)])}
      />
    </>
  );
}
