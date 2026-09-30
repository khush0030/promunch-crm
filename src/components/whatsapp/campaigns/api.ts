"use client";

// Data layer for the WhatsApp campaigns UI: typed fetchers + React Query hooks.
// Every call goes through `request`, which turns an expired session into a
// login redirect and a JSON {error} into a thrown Error with that message.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Campaign, CampaignAudienceFilter, FollowupStage, Recipient, RecipientSummary } from "../types";
import type { CampaignTemplate } from "./logic";

export class RequestError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

export async function request<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    cache: "no-store",
    ...rest,
    ...(json !== undefined
      ? { body: JSON.stringify(json), headers: { "content-type": "application/json", ...(rest.headers ?? {}) } }
      : {}),
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.assign("/login?next=" + encodeURIComponent(window.location.pathname + window.location.search));
    throw new RequestError("Your session expired. Taking you to the login page.", 401, null);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && typeof body === "object" && (body as { ok?: unknown }).ok === false && !("message_id" in body))) {
    const msg = (body as { error?: unknown } | null)?.error;
    throw new RequestError(typeof msg === "string" && msg ? msg : `Request failed (${res.status})`, res.status, body);
  }
  return body as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e ?? "Something went wrong."));

/* ------------------------------------------------------------------------ */
/* Types                                                                      */
/* ------------------------------------------------------------------------ */

export type Quota = {
  tier: string | null;
  quality: string | null;
  limit: number | null;
  limit_source?: "meta" | "manual" | null;
  used24h: number;
  remaining: number | null;
  standing_error?: string | null;
  mm_lite_enabled?: boolean | null;
};

export type PreviewCounts = {
  total_matched: number;
  excluded_suppressed: number;
  already_reached: number;
  excluded_ticket: number;
  excluded_cart: number;
  excluded_governor: number;
  excluded_daily_claim: number;
  eligible_total: number;
  eligible: number;
  /** Follow-ups: reached by the parent but not yet past their wait. */
  waiting_for_time?: number;
};

export type AudiencePreview = {
  filter?: CampaignAudienceFilter;
  counts: PreviewCounts;
  budget: { limit: number | null; used24h: number; remaining_today: number | null; non_campaign_24h: number };
  eta_days: number | null;
};

export type TestSendResult = {
  ok: boolean;
  message_id?: string | null;
  error?: string | null;
  error_code?: number | string | null;
  error_class?: string | null;
  explanation?: { category?: string; cause?: string } | null;
};

// One step of a journey (GET /api/whatsapp/campaigns/[id]/journey), parent
// first. `ordered_count` is optional until the API sends it.
export type JourneyStep = Campaign & {
  depth: number;
  parent_id: string | null;
  eligible_now?: number | null;
  waiting_for_time?: number | null;
  next_eligible_at?: string | null;
  ordered_count?: number | null;
};
export type Journey = { root_id: string; steps: JourneyStep[] };

export type FollowupRule = { followup_of: string; followup_after_hours: number; followup_stage: FollowupStage };

export type Segment = { rfm_tier: string; customers: number; spend: number; avg_recency: number };
export type TagCount = { tag: string; count: number };

export type FailureGroup = { key: string; title: string; msg: string; willRetry: boolean; action: string | null; count: number; sample: string | null };
export type Failures = { total: number; groups: FailureGroup[] };

export type AnalyticsCard = {
  id: string; name: string; status: string; sent: number; deliveredPct: number; readPct: number; failed: number;
  orders: number; revenue: number; cost: number; roi: number | null; grade: string; verdict: string;
};

/* ------------------------------------------------------------------------ */
/* Keys                                                                       */
/* ------------------------------------------------------------------------ */

export const qk = {
  campaigns: ["wa-campaigns"] as const,
  campaign: (id: string) => ["wa-campaign", id] as const,
  quota: ["wa-quota"] as const,
  templates: ["wa-templates-approved"] as const,
  segments: ["wa-segments"] as const,
  tags: ["wa-tags"] as const,
  recipients: (id: string) => ["wa-campaign-recipients", id] as const,
  failures: (id: string) => ["wa-campaign-failures", id] as const,
  analytics: (days: number) => ["wa-campaign-analytics", days] as const,
  preview: (key: string, id: string | null) => ["wa-audience-preview", key, id] as const,
  audienceTiers: (tags: string) => ["wa-audience-tiers", tags] as const,
  journeyAll: ["wa-campaign-journey"] as const,
  journey: (id: string) => ["wa-campaign-journey", id] as const,
  followupPreview: (key: string) => ["wa-followup-preview", key] as const,
};

/* ------------------------------------------------------------------------ */
/* Hooks                                                                      */
/* ------------------------------------------------------------------------ */

const isLive = (s?: string) => s === "sending";

export function useCampaigns() {
  return useQuery({
    queryKey: qk.campaigns,
    queryFn: async () => (await request<{ campaigns: Campaign[] }>("/api/whatsapp/campaigns")).campaigns ?? [],
    refetchInterval: (q) => ((q.state.data ?? []).some((c) => isLive(c.status)) ? 10_000 : 60_000),
  });
}

export function useCampaign(id: string | null) {
  return useQuery({
    queryKey: qk.campaign(id ?? ""),
    enabled: !!id,
    queryFn: async () => (await request<{ campaign: Campaign }>(`/api/whatsapp/campaigns/${id}`)).campaign,
    refetchInterval: (q) => (isLive(q.state.data?.status) ? 10_000 : false),
  });
}

export function useQuota() {
  return useQuery({
    queryKey: qk.quota,
    queryFn: () => request<Quota>("/api/whatsapp/quota"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useApprovedTemplates() {
  return useQuery({
    queryKey: qk.templates,
    queryFn: async () =>
      (await request<{ templates: CampaignTemplate[] }>("/api/whatsapp/templates?status=approved")).templates ?? [],
    staleTime: 60_000,
  });
}

export function useSegments() {
  return useQuery({
    queryKey: qk.segments,
    queryFn: async () => (await request<{ segments: Segment[] }>("/api/whatsapp/segments")).segments ?? [],
    staleTime: 5 * 60_000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: qk.tags,
    queryFn: async () => (await request<{ tags: TagCount[] }>("/api/whatsapp/tags")).tags ?? [],
    staleTime: 5 * 60_000,
  });
}

export function useRecipients(id: string, live: boolean) {
  return useQuery({
    queryKey: qk.recipients(id),
    queryFn: () => request<{ summary: RecipientSummary; recipients: Recipient[] }>(`/api/whatsapp/campaigns/${id}/recipients`),
    refetchInterval: live ? 10_000 : false,
  });
}

export function useFailures(id: string, enabled: boolean, live = false) {
  return useQuery({
    queryKey: qk.failures(id),
    enabled,
    queryFn: () => request<Failures>(`/api/whatsapp/campaigns/${id}/failures`),
    staleTime: live ? 10_000 : 5 * 60_000,
    refetchInterval: live ? 30_000 : false,
  });
}

export function useCampaignAnalytics(days: number, enabled = true) {
  return useQuery({
    queryKey: qk.analytics(days),
    enabled,
    queryFn: () => request<{ campaigns: AnalyticsCard[] }>(`/api/whatsapp/analytics/campaigns?days=${days}`),
    staleTime: 5 * 60_000,
  });
}

export function useAudiencePreview(filter: CampaignAudienceFilter | null, key: string, campaignId: string | null) {
  return useQuery({
    queryKey: qk.preview(key, campaignId),
    enabled: filter != null,
    queryFn: () =>
      request<AudiencePreview>("/api/whatsapp/campaigns/audience-preview", {
        method: "POST",
        json: { audience_filter: filter, campaign_id: campaignId },
      }),
    staleTime: 30_000,
    retry: false,
  });
}

export function useJourney(id: string | null) {
  return useQuery({
    queryKey: qk.journey(id ?? ""),
    enabled: !!id,
    queryFn: () => request<Journey>(`/api/whatsapp/campaigns/${id}/journey`),
    refetchInterval: (q) => ((q.state.data?.steps ?? []).some((st) => isLive(st.status)) ? 15_000 : 60_000),
    retry: 1,
  });
}

// Who a follow-up would reach right now, and how many are still waiting for
// their time. Only meaningful once the parent has reached people.
export function useFollowupPreview(rule: FollowupRule | null) {
  const key = rule ? `${rule.followup_of}|${rule.followup_after_hours}|${rule.followup_stage}` : "";
  return useQuery({
    queryKey: qk.followupPreview(key),
    enabled: rule != null,
    queryFn: () => request<AudiencePreview>("/api/whatsapp/campaigns/audience-preview", { method: "POST", json: rule }),
    staleTime: 30_000,
    retry: false,
  });
}

// Engagement mix for a tag-overlap audience (cold share). Only meaningful for
// plain `tags` filters, which is exactly what /api/whatsapp/audience counts.
export function useTierMix(tags: string[] | null) {
  const key = (tags ?? []).join(",");
  return useQuery({
    queryKey: qk.audienceTiers(key),
    enabled: tags != null,
    queryFn: () =>
      request<{ count: number; byTier: Record<string, number> | null }>(
        `/api/whatsapp/audience${key ? `?tags=${encodeURIComponent(key)}` : ""}`,
      ),
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------------------ */
/* Mutations (plain functions; callers invalidate)                             */
/* ------------------------------------------------------------------------ */

export type CampaignWrite = {
  name?: string;
  template_id?: string;
  template_vars?: Record<string, string>;
  audience_filter?: CampaignAudienceFilter;
  header_media_url?: string | null;
  scheduled_at?: string | null;
  repeat_rule?: string | null;
  repeat_until?: string | null;
  status?: "draft" | "scheduled";
  // Follow-ups: all three together. The server builds the audience itself.
  followup_of?: string;
  followup_after_hours?: number;
  followup_stage?: FollowupStage;
};

export const api = {
  create: (body: CampaignWrite) => request<{ campaign: Campaign }>("/api/whatsapp/campaigns", { method: "POST", json: body }),
  patch: (id: string, body: CampaignWrite) =>
    request<{ campaign: Campaign }>(`/api/whatsapp/campaigns/${id}`, { method: "PATCH", json: body }),
  remove: (id: string) => request<{ ok: true }>(`/api/whatsapp/campaigns/${id}`, { method: "DELETE" }),
  action: (id: string, action: "pause" | "resume" | "cancel") =>
    request<{ campaign: Campaign; engine: unknown }>(`/api/whatsapp/campaigns/${id}/${action}`, { method: "POST" }),
  send: (id: string) =>
    request<{ ok?: boolean; sent?: number; failed?: number; remaining?: number; deferred?: boolean; resume_at?: string; note?: string; status?: string; skipped?: string }>(
      `/api/whatsapp/campaigns/${id}/send`,
      { method: "POST" },
    ),
  testSend: async (body: {
    to: string;
    campaign_id?: string;
    draft?: { template_id: string; template_vars: Record<string, string>; header_media_url?: string | null; name?: string };
    test_name?: string;
  }): Promise<TestSendResult> => {
    // The engine answers 502 with a structured failure; keep the body.
    try {
      return await request<TestSendResult>("/api/whatsapp/campaigns/test-send", { method: "POST", json: body });
    } catch (e) {
      if (e instanceof RequestError && e.body && typeof e.body === "object") return { ok: false, ...(e.body as object) } as TestSendResult;
      return { ok: false, error: errorMessage(e) };
    }
  },
  importCsv: (rows: { phone: string; name?: string; email?: string }[], tag: string) =>
    request<{ ok: boolean; scanned: number; skipped: number; imported: number; error: string | null }>("/api/whatsapp/import-csv", {
      method: "POST",
      json: { rows, tag },
    }),
  tagList: (tag: string, phones: string[]) =>
    request<{ ok: true; tagged: number; matched: number }>("/api/whatsapp/lists", { method: "POST", json: { tag, phones } }),
  setBudget: (limit: number | null) => request<{ ok: true }>("/api/whatsapp/quota", { method: "PATCH", json: { limit } }),
};

export function useInvalidateCampaigns() {
  const qc = useQueryClient();
  return (id?: string | null) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.campaigns }),
      id ? qc.invalidateQueries({ queryKey: qk.campaign(id) }) : null,
      id ? qc.invalidateQueries({ queryKey: qk.recipients(id) }) : null,
      qc.invalidateQueries({ queryKey: qk.journeyAll }),
    ]);
}

// Plain-English summary of one wa-campaign-send response.
export function describeSendResult(j: Awaited<ReturnType<typeof api.send>>): string {
  if (j.skipped) return "It's already sending in the background. Progress updates on this page.";
  if (j.deferred) {
    const when = j.resume_at
      ? new Date(j.resume_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
      : "later";
    return `Queued. Sending starts by itself at ${when}.`;
  }
  if (j.status === "completed") return "Done. Everyone who could get it has been handled.";
  const more = j.remaining ? ` ${j.remaining.toLocaleString("en-IN")} more go out automatically.` : "";
  return `Started: ${(j.sent ?? 0).toLocaleString("en-IN")} sent in the first batch.${more}`;
}
