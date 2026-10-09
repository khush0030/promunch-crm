"use client";

// Creators · Settings · Instagram (moved from the old Instagram page's
// Settings tab). Same calls: GET /api/instagram/settings,
// PATCH /api/instagram/settings with only the changed field.
// While the Instagram side is not switched on, this says so in one line.

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { isIgOff, type IgSettings as Settings } from "./ig";
import s from "./creators.module.css";

export default function IgSettings() {
  const q = useQuery({
    queryKey: ["ig", "settings"],
    queryFn: async (): Promise<Settings | null> => {
      const r = await fetch(`/api/instagram/settings`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "load failed");
      return d.settings ?? null;
    },
    retry: false,
  });

  return (
    <section aria-labelledby="cr-igset-h" style={{ marginTop: 32 }}>
      <div className={s.secH}>
        <h2 id="cr-igset-h">Instagram</h2>
        <p>How the Instagram bot answers collab DMs, which follower range counts as a fit, and the barter terms it offers.</p>
      </div>
      <div className={s.card}>
        {q.isLoading ? (
          <p className={s.muted} style={{ margin: 0 }}>Loading</p>
        ) : isIgOff(q.error?.message) ? (
          <p className={s.small} style={{ margin: 0 }}>
            <span className={s.tg} data-tone="mute">Not switched on yet</span> These settings appear once the Instagram connection is set up.
          </p>
        ) : q.error ? (
          <p className={s.err}>Could not load Instagram settings: {q.error.message}</p>
        ) : !q.data ? (
          <p className={s.small} style={{ margin: 0 }}>No Instagram settings saved yet.</p>
        ) : (
          <Form key={JSON.stringify(q.data)} settings={q.data} />
        )}
      </div>
    </section>
  );
}

function Form({ settings }: { settings: Settings }) {
  const { push } = useToast();
  const qc = useQueryClient();
  // State starts from props; the parent remounts this form (key) when the
  // saved settings change, so no prop-to-state sync effect is needed.
  const [terms, setTerms] = useState(settings.barter_terms ?? "");
  const [min, setMin] = useState(settings.min_followers ?? 1000);
  const [max, setMax] = useState(settings.max_followers ?? 15000);

  const save = useCallback(async (patch: Partial<Settings>) => {
    try {
      const r = await fetch(`/api/instagram/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "save failed");
      qc.setQueryData(["ig", "settings"], d.settings);
      push({ kind: "success", text: "Saved" });
    } catch (e) {
      push({ kind: "error", text: `Could not save: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [push, qc]);

  const toggle = (label: string, desc: string, value: boolean, key: keyof Settings) => (
    <div className={s.setRow}>
      <span className={s.setL}><b>{label}</b><span>{desc}</span></span>
      <button type="button" role="switch" aria-checked={value} aria-label={label} className={s.switch} onClick={() => save({ [key]: !value } as Partial<Settings>)} />
    </div>
  );

  return (
    <>
      {toggle("Pause the Instagram bot", "Stops every automatic reply. New DMs are still saved.", settings.paused, "paused")}
      {toggle("Automatic replies", "AI answers new DMs. Off means sort and flag only.", settings.auto_reply_enabled, "auto_reply_enabled")}
      {toggle("Reply to comments", "Sends a private reply DM to comments on our posts and reels.", settings.auto_reply_comments, "auto_reply_comments")}
      {toggle("Tell the team about collab requests", "Pings the team when a real barter request comes in.", settings.escalate_to_slack, "escalate_to_slack")}
      <div className={s.setRow}>
        <span className={s.setL}><b>Collab replies</b><span>What the bot does with a barter request.</span></span>
        <select
          className={s.select}
          aria-label="Collab replies"
          value={settings.auto_reply_scope}
          onChange={(e) => save({ auto_reply_scope: e.target.value as Settings["auto_reply_scope"] })}
        >
          <option value="routine_only">Say thanks and flag it (safe)</option>
          <option value="all">Reply with our terms and flag it</option>
        </select>
      </div>
      <div className={s.setRow}>
        <span className={s.setL}><b>Follower range we work with</b><span>Used to mark whether a creator fits.</span></span>
        <span className={s.inline}>
          <input className={`${s.input} ${s.num}`} type="number" aria-label="Minimum followers" value={min} onChange={(e) => setMin(+e.target.value)} onBlur={() => min !== settings.min_followers && save({ min_followers: min })} />
          to
          <input className={`${s.input} ${s.num}`} type="number" aria-label="Maximum followers" value={max} onChange={(e) => setMax(+e.target.value)} onBlur={() => max !== settings.max_followers && save({ max_followers: max })} />
        </span>
      </div>
      <div className={s.setCol}>
        <span className={s.setL}><b>Barter terms</b><span>What we offer and what we ask for. The bot uses this when it replies with terms.</span></span>
        <textarea
          className={s.textarea}
          rows={5}
          aria-label="Barter terms"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          placeholder="We send a PROMUNCH box in exchange for 1 reel and 2 stories tagging @promunch within 2 weeks."
        />
        <div>
          <button type="button" className="pm-btn" onClick={() => save({ barter_terms: terms })} disabled={terms === (settings.barter_terms ?? "")}>
            Save terms
          </button>
        </div>
      </div>
    </>
  );
}
