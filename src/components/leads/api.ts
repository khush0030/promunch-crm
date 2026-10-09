// Tiny fetch helpers + shared queries for the B2B one-path views.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StatusResponse } from "./types";

export async function api<T = Record<string, unknown>>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    cache: "no-store",
    ...(init?.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  return json as T;
}

export const STATUS_KEY = ["b2b-status"] as const;

/** The cheap status poll: fast while a search is finding, slow otherwise. */
export function useB2bStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api<StatusResponse>("/api/leads/status"),
    refetchInterval: (q) => {
      const d = q.state.data as StatusResponse | undefined;
      const busy = !!d && (d.searches.some((s) => s.active) || (d.counts.drafting ?? 0) > 0);
      return busy ? 5_000 : 60_000;
    },
    refetchOnWindowFocus: true,
  });
}

/** Refresh everything B2B after an action. */
export function useB2bRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: STATUS_KEY });
    qc.invalidateQueries({ queryKey: ["b2b"] });
  };
}

export function errText(e: unknown, fallback = "Something went wrong"): string {
  return e instanceof Error ? e.message : fallback;
}

export function nf(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-IN");
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${nf(n)} ${n === 1 ? one : many}`;
}
