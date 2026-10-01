"use client";

// Autosave for the wizard's follow-ups. They live in the wizard state from the
// start; once the parent draft exists, each follow-up with a message picked is
// created (POST with followup_of) or updated (PATCH), and one the teammate
// removed is deleted. Saves are serialised, like the parent's autosave.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, RequestError, type CampaignWrite } from "../api";
import { draftHours, followupName, type FollowupDraft } from "../journey";
import { buildTemplateVars, type CampaignTemplate } from "../logic";

type Saved = { id: string; json: string };

/** Thrown by flush() when some follow-ups didn't save (the rest did). */
export class FollowupSaveError extends Error {
  constructor(public failed: Record<string, string>, label: string) {
    super(label);
  }
}

export function followupPayload(d: FollowupDraft, index: number, parentName: string, tpl: CampaignTemplate | null): CampaignWrite | null {
  const hours = draftHours(d);
  if (!d.templateId || hours == null) return null;
  return {
    name: followupName(parentName, index + 1),
    template_id: d.templateId,
    template_vars: buildTemplateVars(d.vars, false, "", tpl),
    header_media_url: d.mediaUrl,
    followup_after_hours: hours,
    followup_stage: d.stage,
  };
}

export function useFollowupSync(opts: {
  parentId: string | null;
  parentName: string;
  drafts: FollowupDraft[];
  templates: CampaignTemplate[];
  enabled: boolean;
  onSaved: (key: string, id: string) => void;
  /** Keys not to send (known exact copies the server would refuse). */
  skip?: Set<string>;
}) {
  const { parentId, parentName, drafts, templates, enabled, onSaved, skip } = opts;
  const savedRef = useRef(new Map<string, Saved>());
  const inflight = useRef<Promise<void> | null>(null);
  const stoppedRef = useRef(false);
  const latest = useRef({ parentId, items: [] as { key: string; id: string | null | undefined; body: CampaignWrite | null }[], skip: new Set<string>() });
  const onSavedRef = useRef(onSaved);
  const [savedSig, setSavedSig] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // Per follow-up: why it didn't save (keyed by draft key).
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stopped, setStopped] = useState(false);

  const items = useMemo(
    () =>
      drafts.map((d, i) => ({
        key: d.key,
        id: d.id,
        body: followupPayload(d, i, parentName.trim() || "Untitled campaign", templates.find((t) => t.id === d.templateId) ?? null),
      })),
    [drafts, parentName, templates],
  );
  const sig = JSON.stringify(items.map((x) => [x.key, x.body]));

  useEffect(() => {
    latest.current = { parentId, items, skip: skip ?? new Set() };
    onSavedRef.current = onSaved;
  }, [parentId, items, onSaved, skip]);

  const sigOfSaved = () => JSON.stringify(Object.fromEntries([...savedRef.current.entries()].map(([k, v]) => [k, v.json])));

  /** Follow-ups loaded from the server count as saved as they are. */
  const setBaseline = useCallback((list: { key: string; id: string; body: CampaignWrite | null }[]) => {
    savedRef.current = new Map(list.map((x) => [x.key, { id: x.id, json: JSON.stringify(x.body) }]));
    setSavedSig(sigOfSaved());
  }, []);

  const flush = useCallback(async (parentOverride?: string): Promise<void> => {
    if (inflight.current) await inflight.current.catch(() => null);
    const parent = parentOverride ?? latest.current.parentId;
    if (!parent || stoppedRef.current) return;
    const run = (async () => {
      const cur = latest.current.items;
      setState("saving");
      try {
        // Removed follow-ups first, so the per-journey limit never trips.
        const keep = new Set(cur.map((x) => x.key));
        for (const [key, sv] of [...savedRef.current.entries()]) {
          if (keep.has(key)) continue;
          try {
            await api.remove(sv.id);
          } catch (e) {
            if (!(e instanceof RequestError && e.status === 404)) throw e;
          }
          savedRef.current.delete(key);
        }
        // One follow-up failing (e.g. the server refuses an exact copy) must
        // not stop the others from saving; remember which one failed.
        const failed: Record<string, string> = {};
        const skipNow = latest.current.skip;
        for (const it of cur) {
          if (!it.body || skipNow.has(it.key)) continue;
          const json = JSON.stringify(it.body);
          const sv = savedRef.current.get(it.key) ?? (it.id ? { id: it.id, json: "" } : null);
          if (sv && sv.json === json) continue;
          try {
            if (sv) {
              await api.patch(sv.id, it.body);
              savedRef.current.set(it.key, { id: sv.id, json });
            } else {
              const res = await api.create({ ...it.body, followup_of: parent });
              savedRef.current.set(it.key, { id: res.campaign.id, json });
              onSavedRef.current(it.key, res.campaign.id);
            }
          } catch (e) {
            if (e instanceof RequestError && e.status === 401) throw e;
            failed[it.key] = errorMessage(e);
          }
        }
        setSavedSig(sigOfSaved());
        setErrors(failed);
        if (Object.keys(failed).length) {
          setState("error");
          setError(null);
          const idx = cur.findIndex((x) => x.key in failed);
          throw new FollowupSaveError(failed, `Follow-up ${idx + 1} wasn't saved: ${failed[cur[idx].key]}`);
        }
        setState("idle");
        setError(null);
      } catch (e) {
        setState("error");
        if (!(e instanceof FollowupSaveError)) setError(errorMessage(e));
        throw e;
      }
    })();
    inflight.current = run;
    try {
      await run;
    } finally {
      inflight.current = null;
    }
  }, []);

  // What the server should hold vs what it holds. Only follow-ups with a
  // message picked are saved; a removed one still on the server is a change.
  const dirty = useMemo(() => {
    const saved = (savedSig ? JSON.parse(savedSig) : {}) as Record<string, string>;
    const keys = new Set(items.map((x) => x.key));
    return (
      items.some((x) => x.body && !skip?.has(x.key) && saved[x.key] !== JSON.stringify(x.body)) ||
      Object.keys(saved).some((k) => !keys.has(k))
    );
  }, [items, savedSig, skip]);

  useEffect(() => {
    if (!enabled || !parentId || !dirty || stopped) return;
    const t = setTimeout(() => {
      flush().catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [sig, enabled, parentId, dirty, stopped, flush]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    setStopped(true);
  }, []);

  return { state, error, errors, dirty: dirty && !!parentId && !stopped, flush, setBaseline, stop };
}
