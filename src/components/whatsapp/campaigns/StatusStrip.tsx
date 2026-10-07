"use client";

// Today's sending budget, Meta standing and the rules the engine follows, in
// one calm hairline card above the campaign list.

import { Pill } from "@/components/pm";
import { HelpTip } from "@/components/guide";
import { useQuota } from "./api";
import { fmtInt, inQuietHours } from "./logic";
import s from "./list.module.css";
import { useNow } from "./useNow";

const QUALITY: Record<string, { label: string; tone: "good" | "warn" | "crit" }> = {
  GREEN: { label: "Good", tone: "good" },
  YELLOW: { label: "At risk", tone: "warn" },
  RED: { label: "Poor", tone: "crit" },
};

export function StatusStrip() {
  const { data: q, isLoading } = useQuota();
  const now = useNow();
  const used = q?.used24h ?? 0;
  const limit = q?.limit ?? null;
  const pctUsed = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const quality = QUALITY[String(q?.quality ?? "").toUpperCase()];
  const quiet = inQuietHours(now);

  return (
    <div className={s.strip} aria-label="Sending status">
      <div className={s.stripItem}>
        <div className={s.stripHead}>
          <div className={s.stripLabel}>Today&apos;s budget</div>
          <HelpTip term="daily_budget" />
        </div>
        <div className={s.stripValue}>
          {isLoading ? "…" : limit != null ? `${fmtInt(q?.remaining ?? 0)} left` : "No daily cap"}
        </div>
        {limit != null ? (
          <>
            <div className={`${s.meter} ${pctUsed >= 100 ? s.meterFull : ""}`} aria-hidden>
              <div style={{ width: `${pctUsed}%` }} />
            </div>
            <div className={s.stripSub}>
              {fmtInt(used)} of {fmtInt(limit)} people messaged in the last 24 hours. Order and journey messages share this budget.
            </div>
          </>
        ) : (
          <div className={s.stripSub}>
            {isLoading
              ? "Checking…"
              : `${fmtInt(used)} people messaged in the last 24 hours. Campaigns go out in small batches and Meta decides how many arrive (about 250 marketing messages a day for our number so far). You can set our own cap under Audience insights below.`}
          </div>
        )}
      </div>

      <div className={s.stripItem}>
        <div className={s.stripHead}>
          <div className={s.stripLabel}>Meta standing</div>
          <HelpTip term="meta_tier" text="Set by Meta from how customers react to our messages. Nobody at PROMUNCH can change it directly; good messages to warm audiences keep it healthy." />
        </div>
        <div className={s.stripValue}>
          {quality ? <Pill tone={quality.tone}>{quality.label}</Pill> : <span>Not rated yet</span>}
        </div>
        <div className={s.stripSub}>
          {q?.limit_source === "manual"
            ? `Our own daily cap of ${fmtInt(limit)} is in charge.`
            : q?.tier
              ? `Meta allows ${q.tier.replace("TIER_", "").toLowerCase()} people a day.`
              : "Meta hasn't given our number a daily tier yet. That's normal for us and nothing you need to do."}
        </div>
        {q?.mm_lite_enabled != null && (
          <div className={s.stripPill}>
            <Pill
              tone={q.mm_lite_enabled ? "good" : "neu"}
              tip={
                q.mm_lite_enabled
                  ? "Marketing messages go through Meta's Marketing Messages API, which can deliver a little more to engaged people."
                  : "Marketing messages go through the standard WhatsApp API."
              }
            >
              {q.mm_lite_enabled ? "Marketing API: on" : "Marketing API: off"}
            </Pill>
          </div>
        )}
      </div>

      <div className={s.stripItem}>
        <div className={s.stripHead}>
          <div className={s.stripLabel}>Quiet hours</div>
          <HelpTip term="quiet_hours" />
        </div>
        <div className={s.stripValue}>{quiet ? "On now" : "9 PM to 9 AM"}</div>
        <div className={s.stripSub}>
          {quiet
            ? "No marketing goes out right now. Campaigns continue by themselves in the morning."
            : "No marketing goes out at night (India time). Anything due then waits for the morning."}
        </div>
      </div>

      <div className={s.stripItem}>
        <div className={s.stripHead}>
          <div className={s.stripLabel}>Fair use</div>
          <HelpTip term="fair_use" />
        </div>
        <div className={s.stripValue}>1 a day per person</div>
        <div className={s.stripSub}>
          Across all campaigns. People with an open support chat, a cart reminder or a recent promo are held and tried again later.
        </div>
      </div>
    </div>
  );
}
