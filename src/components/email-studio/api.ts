// Tiny fetch helpers for Email Studio pages (errors surface as thrown
// messages the pages show in a toast / callout).

import { friendlyText } from "@/lib/email-studio/visual-edit";

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j && typeof j === "object" && "error" in j && j.error)) {
    throw new Error((j as { error?: string }).error || `Request failed (${r.status})`);
  }
  return j as T;
}

export async function sendJson<T>(url: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((j as { error?: string }).error || `Request failed (${r.status})`) as Error & { data?: unknown };
    err.data = j;
    throw err;
  }
  return j as T;
}

export function inr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** Merge tags as readable words for lists: "{{first_name|friend}}" -> "[First name]". */
export function niceText(text: string): string {
  return friendlyText(text.replace(/\{\{\s*([a-z_.]+)\s*\|[^}]*\}\}/g, "{{$1}}"));
}
