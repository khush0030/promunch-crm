import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Estimate the number of opted-in WhatsApp recipients for a campaign audience.
// GET /api/whatsapp/audience?tags=vip,repeat_buyer  (tags optional)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tags = (searchParams.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  let q = supabaseAdmin
    .from("wa_contacts")
    .select("id", { count: "exact", head: true })
    .eq("opted_in", true);
  if (tags.length) q = q.overlaps("tags", tags);

  const { count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 });
}
