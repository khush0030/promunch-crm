import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { canRequestChange, cleanNote } from "@/lib/influencers/portal-rules";
import { isSameOrigin, portalDealOr404, logPortalEvent, readSmallJson, viewResponse } from "@/lib/influencers/portal-server";

export const dynamic = "force-dynamic";

const MAX_OPEN_REQUESTS = 10; // per deal, to stop a stuck finger or a script flooding the team task list

// POST /api/public/collab/[code]/request-change  { message }  (≤ 1000 chars)
// Creator asks for a change to the brief. Writes a timeline event and a team
// task (influencer_reminders kind 'team_change_request', audience team,
// channel task, next free step). Never messages anyone itself.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isSameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const got = await portalDealOr404(code);
  if (!got.ok) return got.response;
  const deal = got.deal;

  const body = await readSmallJson(req);
  if (!body) return NextResponse.json({ error: "Could not read that. Please try again." }, { status: 400 });
  const raw = typeof body.message === "string" ? body.message : "";
  if (raw.trim().length > 1000) return NextResponse.json({ error: "Please keep it under 1000 characters." }, { status: 400 });
  const message = cleanNote(raw, 1000);
  if (!message) return NextResponse.json({ error: "Tell us what you would like changed." }, { status: 400 });
  if (!canRequestChange(deal.stage)) {
    return NextResponse.json(
      { error: "There is nothing to change yet. We will WhatsApp you when your brief is ready." },
      { status: 409 },
    );
  }

  const { data: existing } = await supabaseAdmin
    .from("influencer_reminders")
    .select("step, meta")
    .eq("deal_id", deal.id)
    .eq("kind", "team_change_request")
    .order("step", { ascending: false });
  const rows = (existing ?? []) as { step: number; meta: { message?: string } | null }[];
  // Same text again (double tap / refresh-resubmit) → idempotent.
  if (rows.some((r) => r.meta?.message === message)) return viewResponse(code, { requested: true });
  if (rows.length >= MAX_OPEN_REQUESTS) {
    return NextResponse.json(
      { error: "We have your earlier requests. The team will reply on WhatsApp shortly." },
      { status: 429 },
    );
  }

  let step = (rows[0]?.step ?? 0) + 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabaseAdmin.from("influencer_reminders").insert({
      deal_id: deal.id,
      kind: "team_change_request",
      step,
      audience: "team",
      channel: "task",
      status: "scheduled",
      due_at: new Date().toISOString(),
      meta: { message, stage: deal.stage, source: "portal" },
    });
    if (!error) break;
    if (error.code !== "23505" || attempt === 2) {
      return NextResponse.json({ error: "Could not send your request. Please try again." }, { status: 500 });
    }
    step += 1; // a concurrent request took this step; take the next one
  }

  await logPortalEvent(deal, "change_request", `Creator asked for a change: ${message.slice(0, 140)}`, { message, step });
  return viewResponse(code, { requested: true });
}
