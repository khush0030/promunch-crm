import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, logEvent, readJson, requireUser } from "@/lib/influencers/db";
import { isOpenStage, reliability, type ReliabilityDeal } from "@/lib/influencers/health";
import { influencerFields } from "@/lib/influencers/normalize";
import type { DealStage, InfluencerListItem } from "@/lib/influencers/types";

export const dynamic = "force-dynamic";

// Creators table: every creator with open deal count + reliability.
// ?q= matches handle / name; ?status=active|paused|blocked.
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const sp = req.nextUrl.searchParams;

  let query = supabaseAdmin.from("influencers").select("*").order("created_at", { ascending: false }).limit(1000);
  const status = sp.get("status");
  if (status && ["active", "paused", "blocked"].includes(status)) query = query.eq("status", status);
  const [{ data: creators, error }, { data: deals, error: dErr }] = await Promise.all([
    query,
    supabaseAdmin
      .from("influencer_deals")
      .select("influencer_id, stage, draft_due_at, draft_submitted_at, revision_count")
      .limit(5000),
  ]);
  if (error) return jsonError(error.message, 500);
  if (dErr) return jsonError(dErr.message, 500);

  const byCreator = new Map<string, ReliabilityDeal[]>();
  for (const d of deals ?? []) {
    const list = byCreator.get(d.influencer_id) ?? [];
    list.push(d as ReliabilityDeal);
    byCreator.set(d.influencer_id, list);
  }
  const now = Date.now();
  const q = (sp.get("q") ?? "").trim().toLowerCase().replace(/^@/, "");
  const items: InfluencerListItem[] = (creators ?? [])
    .filter((c) => !q || c.handle.includes(q) || (c.full_name ?? "").toLowerCase().includes(q))
    .map((c) => {
      const ds = byCreator.get(c.id) ?? [];
      return {
        ...c,
        open_deals: ds.filter((d) => isOpenStage(d.stage as DealStage)).length,
        reliability: reliability(ds, now),
      };
    });
  return NextResponse.json({ influencers: items });
}

// Create a creator on their own (Add collab also find-or-creates).
export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  if (!body.handle) return jsonError("handle is required");
  const { fields, error } = influencerFields(body);
  if (error) return jsonError(error);

  const { data, error: insErr } = await supabaseAdmin
    .from("influencers")
    .insert({ ...fields, created_by: gate.actor })
    .select("*")
    .single();
  if (insErr) {
    if (insErr.code === "23505") {
      const { data: existing } = await supabaseAdmin.from("influencers").select("id").eq("handle", fields.handle).maybeSingle();
      return NextResponse.json({ error: "A creator with this handle already exists", id: existing?.id ?? null }, { status: 409 });
    }
    return jsonError(insErr.message, 500);
  }
  await logEvent(data.id, null, "note", "dashboard", gate.actor, `Creator @${data.handle} added`);
  return NextResponse.json({ influencer: data }, { status: 201 });
}
