"use client";

// Autosave for the campaign wizard: creates the draft on the first save, then
// PATCHes whenever the content changes (debounced). Saves are serialised so a
// slow create can never race a second create. Also warns before closing the
// tab with unsaved changes and makes a best-effort save when leaving the page.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Campaign } from "../../types";
import { api, errorMessage, type CampaignWrite } from "../api";
import { UNCHOSEN_AUDIENCE_TAG } from "../logic";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useAutosave(opts: {
  initialId: string | null;
  payload: CampaignWrite | null; // null = nothing worth saving yet
  enabled: boolean;
  onCreated: (c: Campaign) => void;
}) {
  const { initialId, payload, enabled, onCreated } = opts;
  const idRef = useRef<string | null>(initialId);
  const savedRef = useRef<string | null>(null);
  const payloadRef = useRef<CampaignWrite | null>(payload);
  const onCreatedRef = useRef(onCreated);
  const inflight = useRef<Promise<Campaign | null> | null>(null);
  const stoppedRef = useRef(false);
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const json = payload ? JSON.stringify(payload) : null;

  useEffect(() => {
    payloadRef.current = payload;
    onCreatedRef.current = onCreated;
  }, [payload, onCreated]);

  const markSaved = useCallback((j: string | null) => {
    savedRef.current = j;
    setSavedJson(j);
  }, []);

  // Editing an existing campaign: what we loaded is the saved baseline.
  const setBaseline = useCallback((p: CampaignWrite | null) => markSaved(p ? JSON.stringify(p) : null), [markSaved]);

  const saveNow = useCallback(async (): Promise<Campaign | null> => {
    if (inflight.current) await inflight.current.catch(() => null);
    const body = payloadRef.current;
    if (!body) return null;
    const bodyJson = JSON.stringify(body);
    if (bodyJson === savedRef.current && idRef.current) return null;
    const run = (async () => {
      setState("saving");
      try {
        const res = idRef.current
          ? await api.patch(idRef.current, body)
          : await api.create({ ...body, audience_filter: body.audience_filter ?? { tags: [UNCHOSEN_AUDIENCE_TAG] } });
        if (!idRef.current) {
          idRef.current = res.campaign.id;
          onCreatedRef.current(res.campaign);
        }
        markSaved(bodyJson);
        setState("saved");
        setError(null);
        return res.campaign;
      } catch (e) {
        setState("error");
        setError(errorMessage(e));
        throw e;
      }
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, [markSaved]);

  const dirty = !stopped && !!json && json !== savedJson;

  // Debounced autosave.
  useEffect(() => {
    if (!enabled || !dirty) return;
    const t = setTimeout(() => {
      saveNow().catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [json, enabled, dirty, saveNow]);

  // Warn before closing the tab / reloading with unsaved changes.
  useEffect(() => {
    if (!dirty && state !== "saving") return;
    const h = (e: BeforeUnloadEvent) => {
      if (stoppedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, state]);

  // Leaving the page inside the app (sidebar link): best-effort final save.
  useEffect(
    () => () => {
      const body = payloadRef.current;
      if (stoppedRef.current || !body || !idRef.current || JSON.stringify(body) === savedRef.current) return;
      try {
        void fetch(`/api/whatsapp/campaigns/${idRef.current}`, {
          method: "PATCH",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        /* nothing else to do on the way out */
      }
    },
    [],
  );

  // After launch nothing else may be written by autosave.
  const stop = useCallback(() => {
    stoppedRef.current = true;
    setStopped(true);
  }, []);

  return { state, error, dirty, saveNow, setBaseline, stop };
}
