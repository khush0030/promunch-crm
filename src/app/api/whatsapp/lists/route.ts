import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/whatsapp/lists { tag: "list:<name>-<yyyymmdd>", phones: ["9198…"] }
//   -> { ok, matched, tagged }
//
// Adds an uploaded CSV list's tag to people who were ALREADY WhatsApp
// contacts (import-csv only tags the rows it inserts, it never touches
// existing ones). Never changes opted_in: someone who replied STOP stays out
// of every campaign. The campaign then targets audience_filter {tags:[tag]}.
// Uses wa_add_list_tag() (migration 20260929130000) when present, else a
// per-contact update.
const TAG_RE = /^list:[a-z0-9][a-z0-9_-]{0,80}$/;
const MAX_PHONES = 20000;

export async function POST(req: NextRequest) {
  const body = await parseBody<{ tag?: string; phones?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  const tag = String(body.tag ?? "");
  if (!TAG_RE.test(tag)) return NextResponse.json({ error: "tag must look like list:<name>" }, { status: 400 });
  if (!Array.isArray(body.phones)) return NextResponse.json({ error: "phones must be a list" }, { status: 400 });
  const phones = Array.from(new Set(body.phones.map((p) => String(p).replace(/\D/g, "")).filter((p) => p.length >= 11 && p.length <= 15)));
  if (phones.length > MAX_PHONES) return NextResponse.json({ error: `At most ${MAX_PHONES} numbers per list.` }, { status: 400 });

  let tagged = 0;
  let matched = 0;
  // 400 phones keeps the .in() URL well under the proxy limit (~13 chars each).
  for (let i = 0; i < phones.length; i += 400) {
    const slice = phones.slice(i, i + 400);
    const { data: rows, error } = await supabaseAdmin.from("wa_contacts").select("id,wa_id,tags").in("wa_id", slice);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    matched += rows?.length ?? 0;
    const rpc = await supabaseAdmin.rpc("wa_add_list_tag", { p_tag: tag, p_wa_ids: slice });
    if (!rpc.error) {
      tagged += Number(rpc.data ?? 0);
      continue;
    }
    const missing = rpc.error.code === "42883" || rpc.error.code === "PGRST202";
    if (!missing) return NextResponse.json({ error: rpc.error.message }, { status: 500 });
    // Fallback before the migration: read-modify-write per contact.
    for (const r of (rows ?? []) as { id: string; tags: string[] | null }[]) {
      if ((r.tags ?? []).includes(tag)) continue;
      const { error: upErr } = await supabaseAdmin
        .from("wa_contacts")
        .update({ tags: [...(r.tags ?? []), tag] })
        .eq("id", r.id);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
      tagged++;
    }
  }
  return NextResponse.json({ ok: true, matched, tagged });
}
