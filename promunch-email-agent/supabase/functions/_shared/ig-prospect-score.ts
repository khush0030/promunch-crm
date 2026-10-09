// Score + save Instagram profiles into ig_prospects (shared by the Apify
// import in ig-discovery-tick and the free Business Discovery lookup in
// ig-discovery). Score = follower band + engagement + AI niche, then the
// brand / non-India / unchecked caps (_shared/ig-scoring.ts).

import OpenAI from "npm:openai@4.78.0";
import { db } from "./supabase.ts";
import { errStr } from "./connector-log.ts";
import type { ProfileNorm } from "./apify.ts";
import { applyAccountKind, applyAudience, compositeFit, clamp, type AccountKind } from "./ig-scoring.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("IG_AI_MODEL") ?? "gpt-4o-mini";
const UNCHECKED_FIT_CAP = 35;
const NICHE_CHUNK = 8;

export async function scoreAndSaveProfiles(profiles: ProfileNorm[]): Promise<void> {
  const sb = db();
  const { data: settings } = await sb
    .from("ig_settings")
    .select("min_followers, max_followers")
    .eq("id", 1)
    .maybeSingle();
  const min = settings?.min_followers ?? 1000;
  const max = settings?.max_followers ?? 15000;

  profiles = profiles.filter((p) => p.handle);

  // one batched niche call per chunk — bio + captions in, {handle, niche, score} out
  const nicheByHandle = new Map<string, { niche: string | null; score: number; reason: string | null; kind: AccountKind | null; india: "yes" | "no" | "unknown" | null }>();
  for (let i = 0; i < profiles.length; i += NICHE_CHUNK) {
    const chunk = profiles.slice(i, i + NICHE_CHUNK);
    let scored = await nicheScoreBatch(chunk).catch((e) => {
      console.error("[ig-prospect-score] niche scoring failed", errStr(e));
      return [] as Awaited<ReturnType<typeof nicheScoreBatch>>;
    });
    if (scored.length < chunk.length) {
      // one retry, one handle at a time for the ones the batch missed
      const missing = chunk.filter((c) => !scored.some((s) => s.handle === c.handle));
      for (const m of missing) {
        const one = await nicheScoreBatch([m]).catch(() => []);
        scored = scored.concat(one);
      }
    }
    for (const s of scored) nicheByHandle.set(s.handle, s);
  }

  for (const p of profiles) {
    const niche = nicheByHandle.get(p.handle!) ?? { niche: null, score: 0, reason: null, kind: null, india: null };
    // No AI verdict (call failed or skipped this handle): don't hand out
    // full marks on numbers alone; cap until it is re-checked.
    const checked = nicheByHandle.has(p.handle!);
    const fit = Math.min(
      applyAudience(
        applyAccountKind(compositeFit(p.followers, p.engagement_rate, niche.score, min, max), niche.kind),
        niche.india,
      ),
      checked ? 100 : UNCHECKED_FIT_CAP,
    );
    const reasonBits = [
      niche.kind === "brand" ? "Brand or shop account, not a creator" : null,
      niche.india === "no" ? "Audience not in India" : null,
      checked ? null : "Not checked by AI yet",
      niche.reason ? `Niche: ${niche.reason}` : null,
      `Followers: ${p.followers ?? "unknown"}`,
      p.engagement_rate != null ? `ER (last 3): ${(p.engagement_rate * 100).toFixed(1)}%` : "ER: unknown",
    ].filter(Boolean);

    await sb.from("ig_prospects").update({
      full_name: p.full_name,
      profile_pic: p.profile_pic,
      biography: p.biography,
      external_url: p.external_url,
      followers: p.followers,
      media_count: p.media_count,
      avg_likes: p.avg_likes,
      avg_comments: p.avg_comments,
      engagement_rate: p.engagement_rate,
      last3: p.last3,
      bio_email: p.bio_email,
      niche: niche.niche,
      niche_score: clamp(niche.score, 0, 25),
      fit_score: fit,
      fit_reason: reasonBits.join(" · "),
      scraped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("handle", p.handle!);
  }

  // link prospects to threads that already exist for the same handle (the
  // creator has DM'd us before) so the pipeline owns the relationship.
  const handles = profiles.map((p) => p.handle!) as string[];
  if (handles.length) {
    const { data: threads } = await sb
      .from("ig_threads")
      .select("id, handle")
      .in("handle", handles);
    for (const t of threads ?? []) {
      await sb.from("ig_prospects")
        .update({ thread_id: t.id, status: "in_convo", updated_at: new Date().toISOString() })
        .eq("handle", t.handle)
        .is("thread_id", null);
    }
  }
}


// ---- batched AI niche scoring ----------------------------------------------
async function nicheScoreBatch(
  profiles: { handle: string | null; full_name?: string | null; biography: string | null; captions: string[]; business_category?: string | null; is_business?: boolean }[],
): Promise<{ handle: string; niche: string | null; score: number; reason: string | null; kind: AccountKind | null; india: "yes" | "no" | "unknown" | null }[]> {
  if (!OPENAI_API_KEY || !profiles.length) return [];
  const sys =
    `You evaluate Instagram creators for PROMUNCH (Indian healthy-snack brand — protein munchies, ` +
    `edamame, soya crunchies; "Your Munchy Pal"). Food, fitness, health, lifestyle, student and ` +
    `mom-focused creators fit well; unrelated or spammy accounts do not. ` +
    `We want INDIVIDUAL creators (a person who posts content), not brands: shops, food/snack ` +
    `brands, D2C sellers, bakeries, restaurants, cafes, distributors, gyms, agencies and pages ` +
    `that mainly sell products are "brand". A person who has a business account but posts ` +
    `personal content is still "creator". PROMUNCH only sells in India, so also judge whether ` +
    `the account's audience is Indian ("india": "yes" if bio/location/language/captions point to ` +
    `India or Indian cities, Hindi/Hinglish or other Indian languages; "no" if clearly another ` +
    `country; "unknown" if you can't tell).`;
  const user = [
    `For each account below, decide kind ("creator" = an individual person, "brand" = shop/brand/business page), and return a niche label and a 0-25 brand-fit score (give brands 0-5).`,
    ``,
    ...profiles.map((p, i) => [
      `--- CREATOR ${i + 1}: @${p.handle}`,
      `NAME: ${p.full_name ?? "(none)"}`,
      `BIO: ${(p.biography ?? "").slice(0, 300) || "(none)"}`,
      `INSTAGRAM CATEGORY: ${p.business_category ?? (p.is_business ? "business account" : "none")}`,
      `CAPTIONS: ${p.captions.slice(0, 4).map((c) => c.slice(0, 120)).join(" | ") || "(none)"}`,
    ].join("\n")),
    ``,
    `Return JSON ONLY: {"creators":[{"handle":"...","kind":"creator|brand","india":"yes|no|unknown","niche":"<2-4 word label>","score":<0-25>,"reason":"<one short line>"}]}`,
  ].join("\n");

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const resp = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 220 * profiles.length + 300,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
  });
  let parsed: any = null;
  try { parsed = JSON.parse(resp.choices?.[0]?.message?.content ?? ""); } catch { return []; }
  const list = Array.isArray(parsed?.creators) ? parsed.creators : [];
  return list
    .filter((c: any) => typeof c?.handle === "string")
    .map((c: any) => ({
      handle: c.handle.replace(/^@/, "").toLowerCase(),
      niche: (c.niche ?? null) ? String(c.niche).slice(0, 60) : null,
      score: Number(c.score) || 0,
      reason: (c.reason ?? null) ? String(c.reason).slice(0, 200) : null,
      kind: c.kind === "brand" ? "brand" : c.kind === "creator" ? "creator" : null,
      india: c.india === "yes" || c.india === "no" || c.india === "unknown" ? c.india : null,
    }));
}

