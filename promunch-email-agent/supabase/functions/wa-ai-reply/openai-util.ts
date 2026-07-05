// OpenAI response/retry helpers.
// Extracted verbatim from wa-ai-reply/index.ts (audit R5 split). No behavior change.

import OpenAI from "npm:openai@4.78.0";

// Final assistant text from an OpenAI chat-completion response.
export function textOf(resp: any): string {
  return resp?.choices?.[0]?.message?.content ?? "";
}

// OpenAI call with bounded retry on TRANSIENT failures (429 / 5xx / network).
// Safe to retry: every caller is BEFORE any customer send and before the
// per-turn claim, so a retry can never double-message. A transient blip used to
// throw → 500 → the customer waited for the next wa-jobs-tick (minutes); now we
// recover in-line. Non-transient errors (4xx other than 429) fail fast.
export async function chatCreate(client: OpenAI, params: any, retries = 2): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await client.chat.completions.create(params);
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      if (status && status !== 429 && status < 500) break; // not transient
      if (i < retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}
