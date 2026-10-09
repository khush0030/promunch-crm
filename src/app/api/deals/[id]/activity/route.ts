import { NextRequest, NextResponse } from "next/server";
import { LOGGABLE_KINDS, type ActivityKind } from "@/lib/deals/model";
import { longText } from "@/lib/deals/create";
import { addActivity, getDeal } from "@/lib/deals/repo";
import { dealActor, UUID_RE } from "@/lib/deals/session";

export const dynamic = "force-dynamic";

// POST /api/deals/[id]/activity {kind: note|call|whatsapp|meeting, body}
// Appends one entry to the deal's log, authored by the caller. The log is
// append-only (no edit / delete route). Logging a WhatsApp or call here is a
// record of something a person did; it sends nothing.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const who = await dealActor();
  if ("denied" in who) return who.denied;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const kind = (typeof b.kind === "string" ? b.kind : "note") as ActivityKind;
  if (!LOGGABLE_KINDS.includes(kind)) return NextResponse.json({ error: "Pick note, call, WhatsApp or meeting." }, { status: 400 });
  const body = longText(b.body, 4000);
  if (!body) return NextResponse.json({ error: "Write something first." }, { status: 400 });

  try {
    const deal = await getDeal(id);
    if (!deal) return NextResponse.json({ error: "This deal no longer exists." }, { status: 404 });
    const rows = await addActivity(id, [{ kind, body }], who.actor.email);
    return NextResponse.json({ activity: rows[0] ?? null, stored_in_notes: rows.length === 0 }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 500 });
  }
}
