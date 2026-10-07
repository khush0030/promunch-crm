import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getDeal, getDealDetail, getSettings, jsonError, logEvent, readJson, requireUser } from "@/lib/influencers/db";
import { STAGE_LABEL, draftDueAt, isDealStage, stagePatch, type TransitionDeal } from "@/lib/influencers/health";
import { UUID_RE, cleanText, parseDate } from "@/lib/influencers/normalize";
import type { DealStage } from "@/lib/influencers/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");
  try {
    const detail = await getDealDetail(id);
    if (!detail) return jsonError("not found", 404);
    return NextResponse.json(detail);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
}

const USAGE = ["none", "organic_repost", "partnership_ads"];
const intIn = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

// Drawer edits + manual stage moves. Every stage move writes a stage_change
// event; other field edits write one "edit" event. Nothing here messages the
// creator (sends go through the brief/review routes -> influencer-send).
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError("bad id");
  const body = await readJson(req);
  if (!body) return jsonError("bad json");

  const { data: cur, error: curErr } = await supabaseAdmin.from("influencer_deals").select("*").eq("id", id).maybeSingle();
  if (curErr) return jsonError(curErr.message, 500);
  if (!cur) return jsonError("not found", 404);

  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const patch: Record<string, unknown> = {};

  if (has("deliverables")) {
    const d = body.deliverables as Record<string, unknown> | null;
    if (!d || typeof d !== "object" || !["reels", "stories", "posts"].every((k) => intIn(d[k], 0, 50))) {
      return jsonError("deliverables must be {reels, stories, posts} counts");
    }
    patch.deliverables = { reels: d.reels, stories: d.stories, posts: d.posts };
  }
  if (has("usage_rights")) {
    if (typeof body.usage_rights !== "string" || !USAGE.includes(body.usage_rights)) return jsonError("bad usage_rights");
    patch.usage_rights = body.usage_rights;
    if (body.usage_rights === "none") patch.usage_rights_days = null;
  }
  if (has("usage_rights_days")) {
    if (body.usage_rights_days !== null && !intIn(body.usage_rights_days, 1, 3650)) return jsonError("bad usage_rights_days");
    patch.usage_rights_days = body.usage_rights_days;
  }
  if (has("kit_id")) {
    if (body.kit_id !== null && (typeof body.kit_id !== "string" || !UUID_RE.test(body.kit_id))) return jsonError("bad kit_id");
    if (body.kit_id && cur.shopify_order_id) return jsonError("The kit order already exists; the kit can't change now", 409);
    if (body.kit_id) {
      const { data: kit } = await supabaseAdmin.from("influencer_kits").select("id").eq("id", body.kit_id).maybeSingle();
      if (!kit) return jsonError("kit not found");
    }
    patch.kit_id = body.kit_id;
  }
  if (has("draft_due_days")) {
    if (!intIn(body.draft_due_days, 7, 15)) return jsonError("draft_due_days must be 7 to 15");
    patch.draft_due_days = body.draft_due_days;
    if (cur.delivered_at) patch.draft_due_at = draftDueAt(cur.delivered_at, body.draft_due_days as number);
  }
  for (const k of ["draft_due_at", "go_live_at", "delivered_at", "posted_at"] as const) {
    if (!has(k)) continue;
    if (body[k] === null || body[k] === "") {
      if (k === "delivered_at") return jsonError("delivered_at can't be cleared");
      patch[k] = null;
      continue;
    }
    const v = parseDate(body[k]);
    if (!v) return jsonError(`${k} is not a date`);
    patch[k] = v;
  }
  // A corrected delivery date moves the draft due date with it (unless set explicitly).
  if (has("delivered_at") && !has("draft_due_at") && patch.delivered_at) {
    patch.draft_due_at = draftDueAt(patch.delivered_at as string, (patch.draft_due_days as number) ?? cur.draft_due_days);
  }
  if (has("post_url")) {
    const u = cleanText(body.post_url, 500);
    if (u && !/^https?:\/\//i.test(u)) return jsonError("post_url must be a link");
    patch.post_url = u;
  }
  for (const k of ["views_24h", "views_7d"] as const) {
    if (!has(k)) continue;
    if (body[k] !== null && !intIn(body[k], 0, 2_000_000_000)) return jsonError(`bad ${k}`);
    patch[k] = body[k];
  }
  if (has("notes")) patch.notes = cleanText(body.notes, 4000);

  let toStage: DealStage | null = null;
  if (has("stage")) {
    if (!isDealStage(body.stage)) return jsonError("bad stage");
    if (body.stage !== cur.stage) toStage = body.stage;
  }

  const editedFields = Object.keys(patch);
  if (toStage) {
    const settings = await getSettings();
    const merged = { ...cur, ...patch } as TransitionDeal;
    Object.assign(
      patch,
      stagePatch(merged, toStage, Date.now(), {
        postAfterApprovalDays: settings.default_post_after_approval_days,
        deliveredAt: (patch.delivered_at as string | undefined) ?? null,
      }),
    );
    // Explicit dates in the same request win over the stage defaults.
    for (const k of ["draft_due_at", "go_live_at", "posted_at"] as const) {
      if (has(k) && body[k] !== null && body[k] !== "") patch[k] = parseDate(body[k]);
    }
    patch.stage = toStage;
  }
  if (!Object.keys(patch).length) return jsonError("nothing to update");
  patch.updated_at = new Date().toISOString();

  // Compare-and-set on stage so two people moving the same card can't both win.
  const { data: updated, error } = await supabaseAdmin
    .from("influencer_deals")
    .update(patch)
    .eq("id", id)
    .eq("stage", cur.stage)
    .select("id")
    .maybeSingle();
  if (error) return jsonError(error.message, 500);
  if (!updated) return jsonError("This collab changed while you were editing. Refresh and try again.", 409);

  if (toStage) {
    await logEvent(cur.influencer_id, id, "stage_change", "dashboard", gate.actor,
      `Stage: ${STAGE_LABEL[cur.stage as DealStage] ?? cur.stage} to ${STAGE_LABEL[toStage]}`,
      { from: cur.stage, to: toStage });
  }
  if (editedFields.length) {
    await logEvent(cur.influencer_id, id, "edit", "dashboard", gate.actor, `Updated ${editedFields.join(", ")}`, {
      fields: editedFields,
    });
  }

  const deal = await getDeal(id);
  return NextResponse.json({ deal });
}
