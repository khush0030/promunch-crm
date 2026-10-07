// Fetch helpers for the influencer tracker. Every endpoint lives under
// /api/influencers/*. Some routes may not exist yet (built in parallel), so a
// 404 / 501 surfaces as ApiError with `notReady` set and the UI degrades to a
// friendly "not available yet" line instead of crashing.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
  get notReady(): boolean {
    return this.status === 404 || this.status === 501;
  }
}

export async function api<T = unknown>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      cache: "no-store",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : null) ??
      (res.status === 404 || res.status === 501
        ? "This part is not available yet."
        : `Something went wrong (${res.status}).`);
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

/** Endpoints may return `{ key: value }` or the bare value. Accept both. */
export function unwrap<T>(data: unknown, key: string, fallback: T): T {
  if (data && typeof data === "object" && key in (data as Record<string, unknown>)) {
    return ((data as Record<string, unknown>)[key] as T) ?? fallback;
  }
  return (data as T) ?? fallback;
}

export function errText(e: unknown): string | null {
  if (!e) return null;
  if (e instanceof ApiError && e.notReady) return "This part is not available yet. It is still being built.";
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export const QK = {
  summary: ["influencers", "summary"] as const,
  deals: ["influencers", "deals"] as const,
  deal: (id: string) => ["influencers", "deal", id] as const,
  creators: ["influencers", "creators"] as const,
  creator: (id: string) => ["influencers", "creator", id] as const,
  kits: ["influencers", "kits"] as const,
  rules: ["influencers", "kit-rules"] as const,
  settings: ["influencers", "settings"] as const,
};
