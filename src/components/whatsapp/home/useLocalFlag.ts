"use client";
import { useCallback, useSyncExternalStore } from "react";

// A per-browser "done" flag (e.g. "has visited Automations"). Never throws:
// blocked storage just means the flag reads false. Every useLocalFlag with the
// same key updates together.
const EVENT = "pm-wa-local-flag";

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function setLocalFlag(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useLocalFlag(key: string): [boolean, () => void] {
  const on = useSyncExternalStore(subscribe, () => read(key), () => false);
  const set = useCallback(() => setLocalFlag(key), [key]);
  return [on, set];
}

export const FLOWS_VISITED_KEY = "pm-wa-flows-visited";
export const GLOSSARY_SEEN_KEY = "pm-wa-glossary-seen";
