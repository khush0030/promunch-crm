// Client-side fetch wrapper for dashboard pages ("use client" components only).
//
// The middleware answers every /api/* call with 401 {ok:false,error:"unauthorized"}
// once the session expires; without a guard that JSON lands in setState and the
// next render throws. apiFetch turns a 401 into a login redirect and every other
// failure (non-2xx, invalid JSON) into a typed ApiError the caller can show.

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.location.assign("/login?next=" + encodeURIComponent(window.location.pathname));
    }
    throw new ApiError("Session expired. Redirecting to login.", 401);
  }

  let body: unknown;
  let parsed = false;
  try {
    body = await res.json();
    parsed = true;
  } catch {
    // invalid or empty JSON; handled below
  }

  if (!res.ok) {
    const b = (parsed ? body : null) as { error?: unknown; message?: unknown } | null;
    const message =
      (typeof b?.error === "string" && b.error) ||
      (typeof b?.message === "string" && b.message) ||
      res.statusText ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  if (!parsed) throw new ApiError("Invalid JSON in response", res.status);
  return body as T;
}
