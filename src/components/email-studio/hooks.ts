"use client";

import { useQuery } from "@tanstack/react-query";
import type { BrandKit } from "@/lib/email-studio/design";
import type { AudienceRules } from "@/lib/email-studio/segments";
import { getJson } from "./api";

export type StudioSettingsDto = {
  settings: { brand: BrandKit; approval_threshold: number; warmup_max_recipients: number | null };
  canEdit: boolean;
};

export function useStudioSettings() {
  return useQuery({
    queryKey: ["email-studio-settings"],
    queryFn: () => getJson<StudioSettingsDto>("/api/email-studio/settings"),
    staleTime: 60_000,
  });
}

export type SegmentsDto = {
  presets: { key: string; label: string; hint: string; rules: AudienceRules; summary: string }[];
  saved: { id: string; name: string; rules: AudienceRules; last_count: number | null; counted_at: string | null; summary: string }[];
  savedError?: string;
};

export function useSegments() {
  return useQuery({
    queryKey: ["email-studio-segments"],
    queryFn: () => getJson<SegmentsDto>("/api/email-studio/segments"),
  });
}
