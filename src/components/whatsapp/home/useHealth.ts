"use client";
import { useQuery } from "@tanstack/react-query";

export type WaHealth = {
  status?: "up" | "down" | string;
  failedOutbound24h?: number;
  uptime24h?: number | null;
  lastInboundAt?: string | null;
};

// /api/whatsapp/health is open to every teammate. Shared by the page-level
// problem notice and the Start here checklist (one request).
export function useWaHealth() {
  return useQuery({
    queryKey: ["wa-health"],
    queryFn: async (): Promise<WaHealth | null> => {
      const r = await fetch("/api/whatsapp/health", { cache: "no-store" });
      return r.ok ? ((await r.json()) as WaHealth) : null;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
