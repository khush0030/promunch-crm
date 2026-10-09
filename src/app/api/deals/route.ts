import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseNewDeal } from "@/lib/deals/create";
import { istToday, normalizeDeal, SOURCE_LABEL } from "@/lib/deals/model";
import { addActivity, findOpenDuplicate, insertDeal, schemaReady, updateDeal } from "@/lib/deals/repo";
import { dealActor } from "@/lib/deals/session";

export const dynamic = "force-dynamic";

// Full pipeline in one payload (a few hundred deals at most); the client
// filters by type/stage/owner/search locally so the board stays snappy.
// Rows are normalized (new stage names, follow_up_needed = due now) so this
// works before and after the deals_simplify migration.
export async function GET() {
  const who = await dealActor();
  if ("denied" in who) return who.denied;

  const [{ data: deals, error }, { data: scan }, ready] = await Promise.all([
    supabaseAdmin
      .from("deals")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1000),
    supabaseAdmin
      .from("deal_scan_state")
      .select("last_run_at, backfill_done, threads_scanned, last_error, running_since")
      .eq("id", 1)
      .maybeSingle(),
    schemaReady(),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const today = istToday();
  return NextResponse.json({
    deals: (deals ?? []).map((d) => normalizeDeal(d as Record<string, unknown>, today)),
    scan: scan ?? null,
    schema_ready: ready,
  });
}

// POST /api/deals: add a deal. Callers: "Add a deal" form (source manual),
// "Create deal" in a WhatsApp chat (source whatsapp, source_ref thread id),
// "Make it a deal" on a B2B reply (source b2b_reply, source_ref lead id).
// Body contract in src/lib/deals/create.ts.
//
// Dedupes: if an OPEN deal (not Won/Lost) already has the same source_ref,
// email or phone, returns that deal with 200 + existing: true instead of
// creating a second one (blank contact fields on it are filled in).
// New deal -> 201 + existing: false. Never emails or messages anyone.
export async function POST(req: Request) {
  const who = await dealActor();
  if ("denied" in who) return who.denied;
  const { actor } = who;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const parsed = parseNewDeal(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { row, note } = parsed.value;
  if (!row.owner_email && actor.email) row.owner_email = actor.email;

  try {
    const dup = await findOpenDuplicate(row);
    if (dup) {
      const fill: Record<string, unknown> = {};
      if (!dup.contact_email && row.contact_email) fill.contact_email = row.contact_email;
      if (!dup.contact_phone && row.contact_phone) fill.contact_phone = row.contact_phone;
      if (!dup.contact_name && row.contact_name) fill.contact_name = row.contact_name;
      if (!dup.source_ref && row.source_ref && dup.source === row.source) fill.source_ref = row.source_ref;
      const deal = Object.keys(fill).length ? (await updateDeal(dup.id, fill, dup.notes)) ?? dup : dup;
      const via = SOURCE_LABEL[row.source];
      await addActivity(
        dup.id,
        [{ kind: "system", body: `Linked again from ${via}${note ? `: ${note}` : ""}` }],
        actor.email,
      ).catch((e) => console.error("[deals] activity on dedupe failed", e));
      return NextResponse.json({ deal, existing: true });
    }

    const deal = await insertDeal(row);
    await addActivity(
      deal.id,
      [
        { kind: "system", body: `Deal added from ${SOURCE_LABEL[row.source]}${row.source_ref ? ` (${row.source_ref})` : ""}` },
        ...(note ? [{ kind: "note" as const, body: note }] : []),
      ],
      actor.email,
    ).catch((e) => console.error("[deals] activity on create failed", e));
    return NextResponse.json({ deal, existing: false }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not add the deal" }, { status: 500 });
  }
}
