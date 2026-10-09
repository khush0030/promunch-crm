"use client";

// Customers → Segments: the quick segments with how many people each one
// reaches by email right now (prototype other.html #cu-segments). Counts come
// from the read-only GET /api/email-studio/segments/counts, one pass for all.

import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import s from "./QuickSegments.module.css";

export type SegmentCounts = { countedAt: string; presets: Record<string, number>; saved: Record<string, number> };

export function useSegmentCounts() {
  return useQuery({
    // Under the segments key so a save or delete (which invalidates
    // ["email-studio-segments"]) recounts too.
    queryKey: ["email-studio-segments", "counts"],
    queryFn: () => apiFetch<SegmentCounts>("/api/email-studio/segments/counts"),
    staleTime: 5 * 60_000,
  });
}

export function QuickSegments({ presets }: { presets: { key: string; label: string; hint: string }[] }) {
  const counts = useSegmentCounts();
  const n = (k: string) => counts.data?.presets[k];
  return (
    <section className={s.card} aria-labelledby="qs-h">
      <h3 id="qs-h" className={s.h}>Quick segments</h3>
      <ul className={s.list}>
        {presets.map((p) => {
          const v = n(p.key);
          return (
            <li key={p.key} className={s.row}>
              <span className={s.tx}>
                <b>{p.label}</b>
                <span>{p.hint}</span>
              </span>
              <span className={s.num} aria-label={v == null ? undefined : `${v} people with email`}>
                {counts.isLoading ? "…" : v == null ? "–" : v.toLocaleString("en-IN")}
                <span className={s.reach}><Mail aria-hidden="true" /> email</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className={s.foot}>
        {counts.error
          ? "Counts could not load right now. The segments still work when you build a campaign."
          : "Counts are people with an email address who said yes, live right now. Phone-only buyers get WhatsApp instead."}
      </p>
    </section>
  );
}
