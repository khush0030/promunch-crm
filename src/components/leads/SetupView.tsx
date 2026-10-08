"use client";

// B2B · Outreach setup (prototype b2b-setup): the rarely changed things in one
// place. Sender and daily limit (opens the existing settings dialog), follow-up
// campaigns, email starters and results. Each section is the existing view,
// unchanged in behaviour.

import { useState } from "react";
import s from "./b2b.module.css";
import type { OutreachSettings } from "./types";
import SequencesView from "./SequencesView";
import TemplatesView from "./TemplatesView";
import AnalyticsView from "./AnalyticsView";

type Section = "sender" | "followups" | "starters" | "results";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "sender", label: "Sender" },
  { key: "followups", label: "Follow-up campaigns" },
  { key: "starters", label: "Email starters" },
  { key: "results", label: "Results" },
];

export default function SetupView({
  settings, sentToday, onEditSender, onChanged,
}: {
  settings: OutreachSettings | null;
  sentToday: number;
  onEditSender: () => void;
  onChanged: () => void;
}) {
  const [sec, setSec] = useState<Section>("sender");

  return (
    <div className={s.body}>
      <div className={s.chips} role="tablist" aria-label="Setup sections">
        {SECTIONS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={sec === x.key} className={s.chip} data-on={sec === x.key} onClick={() => setSec(x.key)}>
            {x.label}
          </button>
        ))}
      </div>

      {sec === "sender" && (
        <div className={s.setupGrid}>
          <section className={s.card}>
            <div className={s.secT}>
              <h3>Sender</h3>
              <button type="button" className={s.txtLink} onClick={onEditSender} disabled={!settings}>Change</button>
            </div>
            {settings ? (
              <dl className={s.kv}>
                <dt>From</dt><dd>{settings.from_name} · {settings.from_email}</dd>
                <dt>Replies to</dt><dd>{settings.reply_to || settings.from_email}</dd>
                <dt>Daily limit</dt><dd>{settings.daily_cap} emails · {sentToday} sent today</dd>
                <dt>Sending</dt>
                <dd>
                  <span className={s.tg} data-tone={settings.paused ? "warn" : "good"}>{settings.paused ? "Paused" : "On"}</span>
                </dd>
              </dl>
            ) : (
              <p className={s.muted}>Loading…</p>
            )}
          </section>
          <section className={s.card}>
            <h3 style={{ margin: 0, font: "700 var(--pm-h3)/1.25 var(--pm-font)" }}>How sending works</h3>
            <div className={s.tl}>
              <div><b>Review</b><span>You read each AI email and press Send. One press, one email.</span></div>
              <div><b>Follow-up campaigns</b><span>Optional. Put a list into a campaign and the next steps go out on their own, inside the daily limit.</span></div>
              <div><b>Stops by itself</b><span>A reply stops follow-ups. Bounced and blocked addresses are never emailed.</span></div>
            </div>
          </section>
        </div>
      )}

      {sec === "followups" && <SequencesView onChanged={onChanged} />}
      {sec === "starters" && <TemplatesView onChanged={onChanged} />}
      {sec === "results" && <AnalyticsView />}
    </div>
  );
}
