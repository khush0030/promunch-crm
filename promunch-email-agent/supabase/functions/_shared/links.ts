// Click tracking: rewrite plain URLs in an outbound free-text message to short
// /r/<code> links that log a click then redirect. Used by wa-send. Fail-safe by
// design — any error returns the ORIGINAL text unchanged, so a tracking outage
// never blocks a customer's link (especially the cart-recovery checkout URL).

import { db } from "./supabase.ts";

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,!?]/g;
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function code(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export interface LinkMeta {
  contact_id?: string | null;
  thread_id?: string | null;
  journey_run_id?: string | null;
  sent_by?: string | null;
}

// Mint a single tracked short link and return just its code (for dynamic URL
// template buttons, where Meta appends the code to the approved base
// SITE_URL/r/). Returns null on any failure so the caller can fall back.
export async function mintCode(
  sb: ReturnType<typeof db>,
  target: string,
  meta: LinkMeta & { campaign_id?: string | null },
): Promise<string | null> {
  try {
    if (!target) return null;
    const c = code();
    const { error } = await sb.from("wa_short_links").insert({
      code: c,
      target_url: target,
      contact_id: meta.contact_id ?? null,
      journey_run_id: meta.journey_run_id ?? null,
      // campaign attribution rides in sent_by so analytics can group clicks.
      sent_by: meta.campaign_id ? `campaign:${meta.campaign_id}` : (meta.sent_by ?? null),
    });
    return error ? null : c;
  } catch {
    return null;
  }
}

// Replace every URL in `text` with a tracked short link. Returns text unchanged
// on any failure (missing SITE_URL, table not migrated, db error, no URLs).
export async function wrapLinks(
  sb: ReturnType<typeof db>,
  text: string,
  meta: LinkMeta,
): Promise<string> {
  try {
    const base = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");
    if (!base || !text) return text;
    const urls = [...new Set(text.match(URL_RE) ?? [])];
    if (!urls.length) return text;

    const rows = urls.map((u) => ({
      code: code(),
      target_url: u,
      contact_id: meta.contact_id ?? null,
      thread_id: meta.thread_id ?? null,
      journey_run_id: meta.journey_run_id ?? null,
      sent_by: meta.sent_by ?? null,
    }));
    const { data, error } = await sb.from("wa_short_links").insert(rows).select("code,target_url");
    if (error || !data) return text;

    let out = text;
    for (const r of data as { code: string; target_url: string }[]) {
      out = out.split(r.target_url).join(`${base}/r/${r.code}`);
    }
    return out;
  } catch {
    return text;
  }
}
