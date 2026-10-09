"use client";

// "Where things are": Finding -> Ready -> Waiting for approval -> Sent today
// -> Replies. Every number is clickable; pause / daily limit show here too.
import { Tag } from "@/components/pm";
import s from "./b2b.module.css";
import { nf } from "./api";
import type { StatusResponse } from "./types";

export type B2bTab = "find" | "lists" | "approve" | "replies" | "settings";

export default function StatusStrip({ status, onGo }: { status: StatusResponse | undefined; onGo: (tab: B2bTab, extra?: Record<string, string>) => void }) {
  const c = status?.counts ?? {};
  const finding = (c.new ?? 0) + (c.crawling ?? 0);
  const activeSearches = status?.searches.filter((x) => x.active).length ?? 0;
  const ready = c.ready ?? 0;
  const waiting = c.drafted ?? 0;
  const queued = c.approved ?? 0;
  const sentToday = status?.sentToday ?? 0;
  const cap = status?.settings?.daily_cap ?? null;
  const replies = c.replied ?? 0;
  const paused = !!status?.settings?.paused;
  const capHit = cap != null && sentToday >= cap;

  const steps: { key: string; n: React.ReactNode; zero: boolean; label: string; tone: string; go: () => void; title: string }[] = [
    {
      key: "finding",
      n: nf(finding),
      zero: finding === 0 && activeSearches === 0,
      label: activeSearches ? `Finding (${activeSearches} search${activeSearches === 1 ? "" : "es"})` : "Finding",
      tone: "grey",
      go: () => onGo("find"),
      title: "Businesses whose websites are being checked for an email",
    },
    { key: "ready", n: nf(ready), zero: ready === 0, label: "Ready", tone: "blue", go: () => onGo("lists", { show: "ready" }), title: "Have a checked email. Pick them in a list and write emails." },
    { key: "waiting", n: nf(waiting), zero: waiting === 0, label: "Waiting for approval", tone: "amber", go: () => onGo("approve"), title: "Written, waiting for you to read and approve" },
    {
      key: "sent",
      n: <>{nf(sentToday)}{cap != null ? <small> / {nf(cap)}</small> : null}</>,
      zero: sentToday === 0,
      label: "Sent today",
      tone: "green",
      go: () => onGo("replies", { view: "contacted" }),
      title: "Sent today out of the daily limit",
    },
    { key: "replies", n: nf(replies), zero: replies === 0, label: "Replies", tone: "purple", go: () => onGo("replies"), title: "Businesses that wrote back" },
  ];

  return (
    <div>
      <nav className={s.strip} aria-label="Where things are">
        {steps.map((st) => (
          <button key={st.key} type="button" className={s.stp} data-tone={st.tone} data-zero={st.zero} onClick={st.go} title={st.title}>
            <span className={s.stpN}>{st.n}</span>
            <span className={s.stpL}><i aria-hidden />{st.label}</span>
          </button>
        ))}
      </nav>
      {paused || capHit || queued > 0 ? (
        <div className={s.stripNote}>
          {paused ? (
            <>
              <Tag tone="amber" dot>Sending paused</Tag>
              <span>Nothing is written or sent until you turn sending back on in Settings.</span>
            </>
          ) : capHit ? (
            <>
              <Tag tone="amber" dot>Daily limit reached</Tag>
              <span>{queued ? `${nf(queued)} approved emails go out tomorrow.` : "Approved emails go out tomorrow."}</span>
            </>
          ) : (
            <>
              <Tag tone="teal" dot>{nf(queued)} sending soon</Tag>
              <span>
                Approved emails go out a few at a time between {status?.settings?.send_window_start ?? 9}:00 and {status?.settings?.send_window_end ?? 18}:00 IST.
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
