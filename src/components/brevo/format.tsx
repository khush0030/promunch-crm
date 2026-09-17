"use client";

import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsResponse } from "@/app/api/brevo/settings/route";
import { Callout } from "@/components/pm";

// Shared formatting + small building blocks for the Brevo hub.

export const int = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-IN"));

export const rate = (v: number | null | undefined) => (v == null ? "—" : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`);

export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—";

export const dateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const d = await r.json().catch(() => null);
  if (!r.ok || d?.ok === false) throw new Error(d?.error || `request failed (${r.status})`);
  return d as T;
}

export type SectionState<T> = { state: "ok"; data: T } | { state: "gated"; message: string } | { state: "error"; message: string };

// Renders a settled Brevo section: children for ok, a calm notice when the
// plan/account doesn't include the feature, a red one for real failures.
export function SectionView<T>({
  s,
  gatedTitle,
  children,
}: {
  s: SectionState<T>;
  gatedTitle: string;
  children: (data: T) => ReactNode;
}) {
  if (s.state === "ok") return <>{children(s.data)}</>;
  if (s.state === "gated") return <Callout tone="plain" title={gatedTitle} body={s.message} />;
  return <Callout tone="crit" title="Brevo returned an error" body={s.message} />;
}

export function ErrorCallout({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Callout
      tone="crit"
      title={title}
      body={msg.includes("BREVO_API_KEY") ? "No Brevo API key saved. Add it in Settings → API keys." : msg}
      action={
        <button type="button" className="pm2-btn pri sm" onClick={onRetry}>
          Retry
        </button>
      }
    />
  );
}

export class ApiError extends Error {
  constructor(
    message: string,
    public errors: string[] = [],
    public status = 0,
  ) {
    super(message);
  }
}

export async function sendJson<T = Record<string, unknown>>(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || d?.ok === false) throw new ApiError(d?.error || `request failed (${r.status})`, Array.isArray(d?.errors) ? d.errors : [], r.status);
  return d as T;
}

export const errorText = (e: unknown) => (e instanceof ApiError && e.errors.length ? `${e.message}: ${e.errors.join("; ")}` : e instanceof Error ? e.message : String(e));

export const settingsKey = ["brevo-settings"] as const;

export function useBrevoSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: () => getJson<SettingsResponse>("/api/brevo/settings") });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: (readonly unknown[])[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

// Inline result line under an action: green for done, red for failure.
export function Note({ tone, children }: { tone: "ok" | "err" | "muted"; children: ReactNode }) {
  const color = tone === "ok" ? "var(--pm-green)" : tone === "err" ? "var(--pm-s-web)" : "var(--pm-muted)";
  return <div style={{ fontSize: 13, color, marginTop: 8, whiteSpace: "pre-wrap" }}>{children}</div>;
}

export const field: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--pm-border)",
  borderRadius: 8,
  background: "var(--pm-card)",
  color: "inherit",
  font: "inherit",
};
