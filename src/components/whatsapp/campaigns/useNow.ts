"use client";

import { useEffect, useState } from "react";

// Current time as render-safe state, refreshed every `everyMs` (quiet-hours
// notes, "next wave" checks). Keeps renders pure.
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
