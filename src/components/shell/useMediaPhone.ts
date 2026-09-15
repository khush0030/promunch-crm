"use client";
import { useSyncExternalStore } from "react";

// Behaviour-only phone check (layout switches purely in CSS, so there is no
// flash). Server snapshot is false.
const QUERY = "(max-width: 720px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useMediaPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
