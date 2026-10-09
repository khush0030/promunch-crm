"use client";

// React Query plumbing for the Deals screens: the pipeline list, the team
// list (owner picker), and one optimistic PATCH used by the board, the list
// and the drawer. Nothing here sends a message to anyone.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { istToday, normalizeDeal, type Deal, type DealsResponse, type TeamPerson } from "@/lib/deals/model";

export const DEALS_KEY = ["deals"] as const;

export function useDealsQuery() {
  return useQuery({
    queryKey: DEALS_KEY,
    queryFn: async (): Promise<DealsResponse> => {
      const res = await fetch("/api/deals", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load deals");
      return d;
    },
    refetchInterval: 120_000,
  });
}

export function usePeople() {
  return useQuery({
    queryKey: ["deals-people"],
    queryFn: async (): Promise<{ people: TeamPerson[]; me: string | null }> => {
      const res = await fetch("/api/deals/people", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load the team");
      return d;
    },
    staleTime: 10 * 60_000,
  });
}

export type DealPatchBody = Record<string, unknown>;

/** PATCH /api/deals/[id], applied optimistically to the board/list cache. */
export function usePatchDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: DealPatchBody }) => {
      const res = await fetch(`/api/deals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save");
      return d.deal as Deal;
    },
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: DEALS_KEY });
      const prev = qc.getQueryData<DealsResponse>(DEALS_KEY);
      qc.setQueryData<DealsResponse>(DEALS_KEY, (old) =>
        old ? { ...old, deals: old.deals.map((d) => (d.id === id ? optimistic(d, body) : d)) } : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(DEALS_KEY, ctx.prev);
    },
    onSuccess: (deal) => {
      if (!deal) return;
      qc.setQueryData<DealsResponse>(DEALS_KEY, (old) =>
        old ? { ...old, deals: old.deals.map((d) => (d.id === deal.id ? deal : d)) } : old,
      );
    },
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ["deal", v.id] });
      qc.invalidateQueries({ queryKey: DEALS_KEY });
    },
  });
}

function optimistic(d: Deal, body: DealPatchBody): Deal {
  const raw: Record<string, unknown> = { ...d, ...body };
  if (body.done === true) {
    raw.next_step = "next_step" in body ? body.next_step : null;
    raw.follow_up_at = "follow_up_at" in body ? body.follow_up_at : null;
    raw.follow_up_needed = false;
  }
  if ("follow_up_at" in body) raw.follow_up_needed = false;
  if ("stage" in body) raw.closed_reason = body.reason ?? null;
  return normalizeDeal(raw, istToday());
}
