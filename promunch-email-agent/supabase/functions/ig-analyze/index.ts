// Instagram collab analysis: enrich a collab thread with official Business
// Discovery metrics (no scraping), score its brand fit (0–100), and draft
// barter terms grounded in ig_settings.barter_terms + the Master KB for a human
// to review and send. Invoked by the dashboard via /api/instagram/threads/[id]/analyze.
//
// Score = follower-band fit (0–40) + engagement rate (0–35) + AI niche match
// (0–25). Avg reel views is NOT available via Business Discovery for arbitrary
// accounts, so it is intentionally excluded (noted in fit_reason).

import OpenAI from "npm:openai@4.78.0";
import { db } from "../_shared/supabase.ts";
import { requireInternal } from "../_shared/require-internal.ts";
import { businessDiscovery } from "../_shared/instagram.ts";
import { clamp, scoreBand, scoreEr } from "../_shared/ig-scoring.ts";

const BIO_EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MODEL = Deno.env.get("IG_AI_MODEL") ?? "gpt-4o-mini";
const KB_CHAR_BUDGET = 8_000;

interface InvokeBody {
  thread_id: string;
}

Deno.serve(async (req) => {
  const gate = requireInternal(req);
  if (gate) return gate;
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const { thread_id } = (await req.json()) as InvokeBody;
  if (!thread_id) return j({ error: "thread_id required" }, 400);

  const sb = db();
  const [{ data: thread }, { data: settings }] = await Promise.all([
    sb.from("ig_threads").select("id, handle, ig_user_id").eq("id", thread_id).maybeSingle(),
    sb.from("ig_settings").select("min_followers, max_followers, barter_terms").eq("id", 1).maybeSingle(),
  ]);
  if (!thread) return j({ error: "thread not found" }, 404);
  if (!thread.handle) return j({ error: "no handle on this thread — can't run Business Discovery" }, 400);

  const min = settings?.min_followers ?? 20000;
  const max = settings?.max_followers ?? 100000;

  // ---- official public metrics (no scraping) ----
  const bd = await businessDiscovery(thread.handle).catch(() => null);
  const followers = bd?.followers ?? null;
  const er = bd?.engagement_rate ?? null;

  // ---- AI niche score + barter draft, grounded in the Master KB ----
  const kb = await stuffAllDocs(sb);
  const ai = await analyze(thread.handle, bd?.biography ?? null, bd?.captions ?? [], kb, settings?.barter_terms ?? null)
    .catch((e) => {
      console.error("[ig-analyze] AI failed", e);
      return null;
    });
  const nicheScore = clamp(ai?.niche_score ?? 0, 0, 25);

  // ---- composite score ----
  const bandPts = scoreBand(followers, min, max);
  const erPts = scoreEr(er);
  const fitScore = clamp(bandPts + erPts + nicheScore, 0, 100);
  const bandFit = followers != null ? followers >= min && followers <= max : null;

  const reason = [
    ai?.niche_reason ? `Niche: ${ai.niche_reason}` : null,
    `Band fit (${k(min)}–${k(max)}): ${followers != null ? (bandFit ? "yes" : "no") + ` (${k(followers)})` : "unknown"}`,
    `Engagement: ${er != null ? (er * 100).toFixed(1) + "%" : "unknown"}`,
    "Note: avg reel views not available via Business Discovery.",
  ].filter(Boolean).join(" · ");

  await sb.from("ig_threads").update({
    followers,
    engagement_rate: er,
    biography: bd?.biography ?? null,
    bio_email: bd?.biography ? (bd.biography.match(BIO_EMAIL_RE)?.[0]?.toLowerCase() ?? null) : null,
    band_fit: bandFit,
    niche_score: nicheScore,
    fit_score: fitScore,
    fit_reason: reason,
    collab_draft: ai?.draft_terms ?? null,
    collab_draft_at: ai?.draft_terms ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", thread_id);

  return j({
    ok: true,
    fit_score: fitScore,
    band_fit: bandFit,
    followers,
    engagement_rate: er,
    niche_score: nicheScore,
    fit_reason: reason,
    draft: ai?.draft_terms ?? null,
    discovery_ok: !!bd && followers != null,
  });
});

async function analyze(
  handle: string,
  bio: string | null,
  captions: string[],
  kb: string,
  barterTerms: string | null,
): Promise<{ niche_score: number; niche_reason: string; draft_terms: string } | null> {
  const sys =
    `You evaluate Instagram creators for PROMUNCH (Indian healthy-snack brand — protein munchies, ` +
    `edamame, soya crunchies; "Your Munchy Pal") and draft a barter collaboration message.\n` +
    `BRAND COPY RULES (strict): always write "PROMUNCH" in all caps. NEVER use em dashes or en dashes; use commas or full stops.`;
  const user = [
    `BRAND KNOWLEDGE BASE:\n${kb || "(none)"}`,
    "",
    `CREATOR: @${handle}`,
    `BIO: ${bio || "(unknown)"}`,
    `RECENT CAPTIONS:\n${captions.length ? captions.map((c) => `- ${c.slice(0, 200)}`).join("\n") : "(none available)"}`,
    "",
    barterTerms ? `OUR BARTER TERMS (base the draft on these):\n${barterTerms}` : `(No barter terms configured — draft a reasonable product-for-content barter ask.)`,
    "",
    `Return JSON ONLY:`,
    `{`,
    `  "niche_score": <0-25, how well this creator's content/audience fits a healthy-snack brand — food/fitness/lifestyle/student/mom niches score high; unrelated or spammy score low>,`,
    `  "niche_reason": "<one short line on the fit>",`,
    `  "draft_terms": "<a warm, short Instagram DM (3-5 sentences) proposing the barter to this creator: what PROMUNCH sends, what we'd love them to post, and a friendly ask to confirm. Personalise to their niche. No em dashes.>"`,
    `}`,
  ].join("\n");

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const resp = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
  });
  const parsed = parseJson(resp.choices?.[0]?.message?.content ?? "");
  if (!parsed) return null;
  return {
    niche_score: Number(parsed.niche_score) || 0,
    niche_reason: (parsed.niche_reason ?? "").toString(),
    draft_terms: (parsed.draft_terms ?? "").toString().trim(),
  };
}

async function stuffAllDocs(sb: any): Promise<string> {
  const { data: docs } = await sb.from("kb_documents").select("name, raw_text").eq("status", "ready");
  const masterRank = (n: string) => (/master|policy|policies|pricing|faq/i.test(n) ? 0 : 1);
  const ready = (docs ?? [])
    .filter((d: any) => d.raw_text && String(d.raw_text).trim())
    .sort((a: any, b: any) => masterRank(a.name) - masterRank(b.name));
  let kb = "";
  for (const d of ready) {
    const block = `## ${d.name}\n${d.raw_text}`;
    if (kb.length + block.length + 2 > KB_CHAR_BUDGET) {
      const room = KB_CHAR_BUDGET - kb.length - 2;
      if (room > 200) kb += (kb ? "\n\n" : "") + block.slice(0, room);
      break;
    }
    kb += (kb ? "\n\n" : "") + block;
  }
  return kb;
}

function parseJson(s: string): any {
  if (!s) return null;
  const t = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const open = t.indexOf("{");
  const close = t.lastIndexOf("}");
  if (open === -1 || close <= open) return null;
  try { return JSON.parse(t.slice(open, close + 1)); } catch { /* fall through */ }
  // repair raw newlines inside strings, then retry
  let res = "", inStr = false, esc = false;
  for (const ch of t.slice(open, close + 1)) {
    if (esc) { res += ch; esc = false; continue; }
    if (ch === "\\") { res += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; res += ch; continue; }
    if (inStr && (ch === "\n" || ch === "\r")) { res += "\\n"; continue; }
    res += ch;
  }
  try { return JSON.parse(res.replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
