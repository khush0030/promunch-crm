"use client";

// Today's sending budget, Meta standing and the rules the engine follows, in
// four compact tiles above the campaign list.

import { Pill } from "@/components/pm";
import { useQuota } from "./api";
import { fmtInt, inQuietHours } from "./logic";
import s from "./campaigns.module.css";
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
        <div className={s.stripLabel}>Today&apos;s budget</div>
        <div className={s.stripValue}>
          {isLoading ? "…" : limit != null ? `${fmtInt(q?.remaining ?? 0)} left` : "Not set"}
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
          <div className={s.stripSub}>We couldn&apos;t read a daily limit. Set one under Audience insights below.</div>
        )}
      </div>

      <div className={s.stripItem}>
        <div className={s.stripLabel}>Meta standing</div>
        <div className={s.stripValue} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {quality ? <Pill tone={quality.tone}>{quality.label}</Pill> : <span>Unknown</span>}
        </div>
        <div className={s.stripSub}>
          {q?.limit_source === "manual"
            ? `Our own daily cap of ${fmtInt(limit)} is in charge.`
            : q?.tier
              ? `Meta allows ${q.tier.replace("TIER_", "").toLowerCase()} people a day.`
              : "Meta hasn't given our number a daily tier yet."}
        </div>
        {q?.mm_lite_enabled != null && (
          <div style={{ marginTop: 6 }}>
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
        <div className={s.stripLabel}>Quiet hours</div>
        <div className={s.stripValue}>{quiet ? "On now" : "9 PM to 9 AM"}</div>
        <div className={s.stripSub}>
          {quiet
            ? "No marketing goes out right now. Campaigns continue by themselves in the morning."
            : "No marketing goes out at night (India time). Anything due then waits for the morning."}
        </div>
      </div>

      <div className={s.stripItem}>
        <div className={s.stripLabel}>Fair use</div>
        <div className={s.stripValue}>1 a day per person</div>
        <div className={s.stripSub}>
          Across all campaigns. People with an open support chat, a cart reminder or a recent promo are held and tried again later.
        </div>
      </div>
    </div>
  );
}
