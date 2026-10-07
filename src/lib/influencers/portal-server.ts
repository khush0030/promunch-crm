// Server-only loaders for the public creator portal. The portal code IS the
// credential, so everything here selects only what the creator may see: no
// address, phone, email, internal notes, or any other deal.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logEvent } from "./db";
import { isValidPortalCode } from "./portal-rules";
import type { TransitionDeal } from "./health";
import type { BriefContent, DealStage, Deliverables, PortalView } from "./types";

export interface PortalDeal extends TransitionDeal {
  id: string;
  influencer_id: string;
  code: string;
  stage: DealStage;
  deliverables: Deliverables;
  kit_id: string | null;
  draft_due_at: string | null;
  order_status_url: string | null;
  post_url: string | null;
}

// Only what the portal needs + the timestamps stagePatch() reads. No PII.
const DEAL_COLS =
  "id, influencer_id, code, stage, deliverables, kit_id, draft_due_days, draft_due_at, go_live_at, order_status_url, post_url, " +
  "brief_sent_at, brief_acknowledged_at, dispatched_at, delivered_at, draft_submitted_at, draft_approved_at, posted_at, completed_at";

export async function loadPortalDeal(code: string): Promise<PortalDeal | null> {
  if (!isValidPortalCode(code)) return null;
  const { data, error } = await supabaseAdmin.from("influencer_deals").select(DEAL_COLS).eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PortalDeal | null) ?? null;
}

/** Latest SENT brief for the deal (the only one a creator ever sees). */
export async function latestSentBrief(dealId: string) {
  const { data } = await supabaseAdmin
    .from("influencer_briefs")
    .select("id, version, content, sent_at, acknowledged_at")
    .eq("deal_id", dealId)
    .eq("status", "sent")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; version: number; content: BriefContent; sent_at: string | null; acknowledged_at: string | null } | null;
}

export async function buildPortalView(deal: PortalDeal): Promise<PortalView> {
  const [{ data: inf }, kitRes, brief, { data: drafts }] = await Promise.all([
    supabaseAdmin.from("influencers").select("handle, full_name").eq("id", deal.influencer_id).maybeSingle(),
    deal.kit_id
      ? supabaseAdmin.from("influencer_kits").select("name, items").eq("id", deal.kit_id).maybeSingle()
      : Promise.resolve({ data: null }),
    latestSentBrief(deal.id),
    supabaseAdmin
      .from("influencer_drafts")
      .select("version, url, note, review_status, review_note, submitted_at")
      .eq("deal_id", deal.id)
      .order("version", { ascending: true }),
  ]);

  const kitRow = kitRes.data as { name: string; items: { title?: string; qty?: number }[] | null } | null;
  const handle = (inf?.handle as string | undefined) ?? "";
  return {
    code: deal.code,
    creator_name: ((inf?.full_name as string | null) || "").trim() || (handle ? `@${handle}` : "there"),
    handle,
    stage: deal.stage,
    deliverables: deal.deliverables,
    kit: kitRow
      ? {
          name: kitRow.name,
          items: (Array.isArray(kitRow.items) ? kitRow.items : []).map((i) => ({
            title: String(i?.title ?? "PROMUNCH pack"),
            qty: Number(i?.qty ?? 1) || 1,
          })),
        }
      : null,
    brief: brief
      ? { version: brief.version, content: brief.content, sent_at: brief.sent_at, acknowledged_at: brief.acknowledged_at }
      : null,
    draft_due_at: deal.draft_due_at,
    go_live_at: deal.go_live_at,
    order_status_url: deal.order_status_url,
    drafts: (drafts ?? []).map((d) => ({
      version: d.version as number,
      // uploaded files stay private; the creator just sees that it arrived
      url: (d.url as string | null) ?? null,
      note: d.note as string | null,
      review_status: d.review_status as "pending" | "approved" | "changes_requested",
      review_note: d.review_note as string | null,
      submitted_at: d.submitted_at as string,
    })),
    post_url: deal.post_url,
  };
}

/** Shared prelude for every /api/public/collab/[code]/* route. */
export async function portalDealOr404(
  code: string,
): Promise<{ ok: true; deal: PortalDeal } | { ok: false; response: NextResponse }> {
  if (!isValidPortalCode(code)) return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
  try {
    const deal = await loadPortalDeal(code);
    if (!deal) return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
    return { ok: true, deal };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 }) };
  }
}

/** Re-read the deal and return the fresh portal view (200). */
export async function viewResponse(code: string, extra: Record<string, unknown> = {}): Promise<NextResponse> {
  const deal = await loadPortalDeal(code);
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const view = await buildPortalView(deal);
  return NextResponse.json({ ok: true, ...extra, view }, { headers: { "Cache-Control": "no-store" } });
}

/** Parse a small JSON body; refuses bodies over ~8 KB. */
export async function readSmallJson(req: Request): Promise<Record<string, unknown> | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 8192) return null;
  try {
    const text = await req.text();
    if (text.length > 8192) return null;
    if (!text.trim()) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Same-origin check for portal mutations: browsers send Origin on POST. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; the code is still the credential
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Timeline event for a creator action (channel portal, actor creator). */
export const logPortalEvent = (deal: PortalDeal, type: string, summary: string, meta: Record<string, unknown> = {}) =>
  logEvent(deal.influencer_id, deal.id, type, "portal", "creator", summary, meta);
