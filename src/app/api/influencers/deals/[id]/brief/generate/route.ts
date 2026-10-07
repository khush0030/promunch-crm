import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getKnowledgeBase } from "@/lib/leads/kb";
import { DRAFT_MODEL } from "@/lib/leads/draft";
import { getSecret } from "@/lib/secrets";
import { jsonError, logEvent, requireUser } from "@/lib/influencers/db";
import { UUID_RE } from "@/lib/influencers/normalize";
import { enforceBriefRules, formatIstDate, validateBriefContent } from "@/lib/influencers/brief-content";
import { BRIEF_JSON_SCHEMA, BRIEF_SYSTEM_PROMPT, buildBriefUserPrompt } from "@/lib/influencers/brief-prompt";
import type { Deliverables, UsageRights } from "@/lib/influencers/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/influencers/deals/[id]/brief/generate
// AI-writes a new DRAFT brief version grounded in the Master KB (kb_documents,
// same getKnowledgeBase() the B2B + IG drafters use). Inserts version max+1,
// moves agreed → brief_draft, logs an event. Sends nothing.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError("deal not found", 404);

  const { data: deal } = await supabaseAdmin
    .from("influencer_deals")
    .select(
      "id, influencer_id, stage, deliverables, usage_rights, usage_rights_days, kit_id, draft_due_days, draft_due_at, go_live_at, notes",
    )
    .eq("id", id)
    .maybeSingle();
  if (!deal) return jsonError("deal not found", 404);
  if (deal.stage === "cancelled" || deal.stage === "ghosted" || deal.stage === "completed") {
    return jsonError(`deal is ${deal.stage}`, 409);
  }

  const [{ data: inf }, kitRes] = await Promise.all([
    supabaseAdmin
      .from("influencers")
      .select("handle, full_name, niche, tier, followers, notes, discount_code")
      .eq("id", deal.influencer_id)
      .maybeSingle(),
    deal.kit_id
      ? supabaseAdmin.from("influencer_kits").select("name, items").eq("id", deal.kit_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!inf) return jsonError("creator not found", 404);

  const apiKey = await getSecret("OPENAI_API_KEY");
  if (!apiKey) return jsonError("OPENAI_API_KEY is not configured", 500);
  const kb = await getKnowledgeBase();

  const deliverables = (deal.deliverables ?? { reels: 1, stories: 0, posts: 0 }) as Deliverables;
  const usageRights = (deal.usage_rights ?? "none") as UsageRights;
  const kit = kitRes.data as { name: string; items: { title?: string; qty?: number }[] | null } | null;
  const draftDue = formatIstDate(deal.draft_due_at) ?? `${deal.draft_due_days} days after your box arrives`;
  const goLive = formatIstDate(deal.go_live_at);

  const user = buildBriefUserPrompt(
    {
      handle: inf.handle,
      creator_name: inf.full_name,
      niche: inf.niche ?? [],
      tier: inf.tier,
      followers: inf.followers,
      creator_notes: inf.notes,
      deal_notes: deal.notes,
      kit_name: kit?.name ?? null,
      kit_items: (kit?.items ?? []).map((i) => ({ title: String(i?.title ?? ""), qty: Number(i?.qty ?? 1) || 1 })),
      deliverables,
      usage_rights: usageRights,
      usage_rights_days: deal.usage_rights_days,
      discount_code: inf.discount_code,
      draft_due: draftDue,
      go_live: goLive,
    },
    kb,
  );

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DRAFT_MODEL,
      max_tokens: 1800,
      temperature: 0.7,
      response_format: { type: "json_schema", json_schema: BRIEF_JSON_SCHEMA },
      messages: [
        { role: "system", content: BRIEF_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return jsonError(err?.error?.message ?? `OpenAI HTTP ${res.status}`, 502);
  }
  const data = await res.json();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "null");
  } catch {
    /* handled below */
  }
  const v = validateBriefContent({
    ...(parsed && typeof parsed === "object" ? parsed : {}),
    dates: { draft_due: draftDue, go_live: goLive },
  });
  if (!v.ok) return jsonError(`AI brief was not usable (${v.error}). Try again.`, 502);
  const content = enforceBriefRules(
    { ...v.value, hooks: v.value.hooks.slice(0, 3) },
    {
      deliverables,
      discount_code: inf.discount_code,
      usage_rights: usageRights,
      usage_rights_days: deal.usage_rights_days,
      draft_due: draftDue,
      go_live: goLive,
    },
  );

  // version = max+1; the unique (deal_id, version) index settles a race.
  let brief: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 3 && !brief; attempt++) {
    const { data: last } = await supabaseAdmin
      .from("influencer_briefs")
      .select("version")
      .eq("deal_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = ((last?.version as number | undefined) ?? 0) + 1;
    const { data: row, error } = await supabaseAdmin
      .from("influencer_briefs")
      .insert({ deal_id: id, version, status: "draft", content, generated_by: "ai" })
      .select("*")
      .single();
    if (row) brief = row;
    else if (error && error.code !== "23505") return jsonError(error.message, 500);
  }
  if (!brief) return jsonError("could not save the brief, try again", 409);

  if (deal.stage === "agreed") {
    await supabaseAdmin
      .from("influencer_deals")
      .update({ stage: "brief_draft", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("stage", "agreed");
  }
  await logEvent(deal.influencer_id, id, "brief_generated", "dashboard", gate.actor, `AI drafted brief v${brief.version}`, {
    version: brief.version,
    ...(deal.stage === "agreed" ? { from: "agreed", to: "brief_draft" } : {}),
  });

  return NextResponse.json({ ok: true, brief });
}
