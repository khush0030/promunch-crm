// Brevo (email marketing) API client. Server-only.
// Plan: docs/plans/2026-09-17-brevo-integration.md

import { getSecret } from "@/lib/secrets";
import type { BrevoCampaign } from "@/lib/brevo-campaigns";

const BREVO_BASE = "https://api.brevo.com/v3";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

// A Brevo error with its HTTP status and Brevo's own `code`. `planGated` marks
// responses that mean "your plan or account setup doesn't allow this" rather
// than a bug, so pages can show a notice instead of an error.
export class BrevoError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "BrevoError";
  }
  get planGated(): boolean {
    return isPlanGated(this.status, this.code, this.message);
  }
  get notFound(): boolean {
    return this.status === 404 || this.code === "document_not_found";
  }
}

export function isPlanGated(status: number, code: string | null, message: string): boolean {
  if (status === 403 || code === "permission_denied") return true;
  return /not eligible|upgrade to|not (yet )?activated|forbidden/i.test(message);
}

async function getKey(): Promise<string> {
  const key = await getSecret("BREVO_API_KEY");
  if (!key) throw new BrevoError(401, "missing_key", "BREVO_API_KEY is not set (Settings → API keys)");
  return key;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function brevo<T>(method: Method, path: string, body?: unknown, retries = 3): Promise<T> {
  const key = await getKey();
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`${BREVO_BASE}${path}`, {
      method,
      headers: {
        "api-key": key,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const j = (json ?? {}) as { code?: string; message?: string; error?: string };
      throw new BrevoError(res.status, j.code ?? null, j.message || j.error || text.slice(0, 200) || `HTTP ${res.status}`);
    }
    return json as T;
  }
  throw new BrevoError(429, "rate_limited", "Brevo API: rate limit retries exhausted");
}

export const brevoGet = <T>(path: string) => brevo<T>("GET", path);

/** Runs a read and returns null (instead of throwing) when Brevo says "not found". */
export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof BrevoError && e.notFound) return null;
    throw e;
  }
}

// Settled result for pages that assemble several independent Brevo reads:
// one failing section must not blank the whole page.
export type Section<T> =
  | { state: "ok"; data: T }
  | { state: "gated"; message: string }
  | { state: "error"; message: string };

export async function section<T>(p: Promise<T>): Promise<Section<T>> {
  try {
    return { state: "ok", data: await p };
  } catch (e) {
    if (e instanceof BrevoError && e.planGated) return { state: "gated", message: e.message };
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

// ---- email campaigns --------------------------------------------------------

/** All email campaigns (any status) with global stats, newest first. */
export async function listEmailCampaigns(): Promise<BrevoCampaign[]> {
  const out: BrevoCampaign[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      sort: "desc",
      statistics: "globalStats",
      excludeHtmlContent: "true",
    });
    const body = await brevoGet<{ campaigns?: BrevoCampaign[] }>(`/emailCampaigns?${q}`);
    const batch = body.campaigns ?? [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

/** Paginates any Brevo list endpoint that takes limit/offset. */
export async function listAll<T>(path: string, key: string, limit = 50): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await brevoGet<Record<string, unknown>>(`${path}${sep}limit=${limit}&offset=${page * limit}`);
    const batch = (body?.[key] as T[] | undefined) ?? [];
    out.push(...batch);
    if (batch.length < limit) break;
  }
  return out;
}
