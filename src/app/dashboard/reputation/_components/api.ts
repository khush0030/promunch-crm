// Fetch helpers + React Query keys for the Reputation page (/api/orm/*).
// Same shape as the influencer tracker's api.ts: errors carry the server's
// plain-English message.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
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
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : res.status === 403
          ? "Only admins can change this."
          : `Something went wrong (${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export function errText(e: unknown): string | null {
  if (!e) return null;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export const QK = {
  all: ["orm"] as const,
  mentions: ["orm", "mentions"] as const,
  mention: (id: string) => ["orm", "mention", id] as const,
  summary: (days: number) => ["orm", "summary", days] as const,
  settings: ["orm", "settings"] as const,
  aiVisibility: ["orm", "ai-visibility"] as const,
};
