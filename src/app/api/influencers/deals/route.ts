import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  dealFiltersFrom,
  getDeal,
  getSettings,
  insertDealWithCode,
  jsonError,
  listDeals,
  logEvent,
  readJson,
  requireUser,
  suggestKit,
} from "@/lib/influencers/db";
import { UUID_RE, cleanAddress, influencerFields, normalizeHandle, normalizePhone, parseDate } from "@/lib/influencers/normalize";

export const dynamic = "force-dynamic";

// Board / list: ?health=overdue,at_risk &stage=delivered &group=review &q=handle &closed=0
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  try {
    const deals = await listDeals(dealFiltersFrom(req.nextUrl.searchParams));
    return NextResponse.json({ deals });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}

const count = z.number().int().min(0).max(50);
const AddCollab = z.object({
  handle: z.string().min(1),
  phone: z.union([z.string(), z.number()]),
  full_name: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  niche: z.union([z.array(z.string()), z.string()]).optional(),
  followers: z.number().nullable().optional(),
  engagement_rate: z.number().nullable().optional(),
  avg_views: z.number().nullable().optional(),
  address: z.record(z.string(), z.unknown()).optional().nullable(),
  kit_id: z.string().regex(UUID_RE).nullable().optional(),
  deliverables: z.object({ reels: count, stories: count, posts: count }).optional(),
  draft_due_days: z.number().int().min(7).max(15).optional(),
  go_live_at: z.string().nullable().optional(),
  usage_rights: z.enum(["none", "organic_repost", "partnership_ads"]).optional(),
  usage_rights_days: z.number().int().min(1).max(3650).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

// Add collab: find-or-create the creator by handle, save their address,
// create the deal (stage agreed) with a portal code. Schedules nothing: the
// tick arms reminders from the stage, and nothing is sent from here.
export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const raw = await readJson(req);
  if (!raw) return jsonError("bad json");
  const parsed = AddCollab.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return jsonError(`${i.path.join(".") || "body"}: ${i.message}`);
  }
  const body = parsed.data;
  const handle = normalizeHandle(body.handle);
  if (!handle) return jsonError("handle is not a valid Instagram handle");
  if (!normalizePhone(body.phone)) return jsonError("phone is not a valid number");
  const goLive = body.go_live_at ? parseDate(body.go_live_at) : null;
  if (body.go_live_at && !goLive) return jsonError("go_live_at is not a date");

  // Only profile keys the form actually sent (so a blank field never wipes data).
  const profileKeys = ["phone", "full_name", "email", "city", "niche", "followers", "engagement_rate", "avg_views"];
  const profileBody: Record<string, unknown> = {};
  for (const k of profileKeys) {
    const v = (raw as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== "") profileBody[k] = v;
  }
  const { fields, error: fErr } = influencerFields(profileBody);
  if (fErr) return jsonError(fErr);

  const settings = await getSettings();
  const now = new Date().toISOString();

  // Find or create the creator. A concurrent insert of the same handle loses
  // the unique index race and falls back to the existing row.
  let created = false;
  let { data: inf } = await supabaseAdmin.from("influencers").select("*").eq("handle", handle).maybeSingle();
  if (!inf) {
    const ins = await supabaseAdmin
      .from("influencers")
      .insert({ handle, ...fields, created_by: gate.actor })
      .select("*")
      .single();
    if (ins.error && ins.error.code !== "23505") return jsonError(ins.error.message, 500);
    if (ins.data) {
      inf = ins.data;
      created = true;
    } else {
      inf = (await supabaseAdmin.from("influencers").select("*").eq("handle", handle).maybeSingle()).data;
    }
  } else if (Object.keys(fields).length) {
    const up = await supabaseAdmin
      .from("influencers")
      .update({ ...fields, updated_at: now })
      .eq("id", inf.id)
      .select("*")
      .single();
    if (up.error) return jsonError(up.error.message, 500);
    inf = up.data;
  }
  if (!inf) return jsonError("could not find or create the creator", 500);
  if (inf.status === "blocked") return jsonError(`@${handle} is blocked; unblock them in Creators first`, 409);

  const addr = cleanAddress(body.address);
  if (addr) {
    const { error } = await supabaseAdmin.from("influencer_addresses").upsert(
      {
        influencer_id: inf.id,
        ...addr,
        name: addr.name ?? inf.full_name ?? null,
        phone: addr.phone ?? inf.phone ?? null,
        updated_at: now,
      },
      { onConflict: "influencer_id" },
    );
    if (error) return jsonError(error.message, 500);
  }

  let kitId = body.kit_id ?? null;
  if (body.kit_id === undefined) kitId = await suggestKit(inf.followers, inf.niche);
  if (kitId) {
    const { data: kit } = await supabaseAdmin.from("influencer_kits").select("id").eq("id", kitId).maybeSingle();
    if (!kit) return jsonError("kit not found");
  }

  let dealId: string;
  try {
    const row = await insertDealWithCode({
      influencer_id: inf.id,
      type: "barter",
      stage: "agreed",
      deliverables: body.deliverables ?? { reels: 1, stories: 0, posts: 0 },
      requires_draft_approval: true,
      usage_rights: body.usage_rights ?? "none",
      usage_rights_days: body.usage_rights && body.usage_rights !== "none" ? (body.usage_rights_days ?? null) : null,
      kit_id: kitId,
      draft_due_days: body.draft_due_days ?? settings.default_draft_due_days,
      go_live_at: goLive,
      notes: body.notes?.trim() || null,
      created_by: gate.actor,
    });
    dealId = row.id as string;
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }

  if (created) await logEvent(inf.id, null, "note", "dashboard", gate.actor, `Creator @${handle} added`);
  await logEvent(inf.id, dealId, "stage_change", "dashboard", gate.actor, "Collab agreed", {
    from: null,
    to: "agreed",
    kit_id: kitId,
    kit_suggested: body.kit_id === undefined,
  });

  const deal = await getDeal(dealId, settings);
  return NextResponse.json({ deal, influencer_created: created }, { status: 201 });
}
