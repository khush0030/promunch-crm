import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Every tag on opted-in WhatsApp contacts, with how many people carry it.
// Read-only; powers the tag picker in the campaign wizard.
// GET /api/whatsapp/tags -> { tags: [{ tag, count }] } (most used first)
export async function GET() {
  const counts = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("wa_contacts")
      .select("tags")
      .eq("opted_in", true)
      .not("tags", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    for (const row of data as { tags: string[] | null }[]) {
      for (const t of row.tags ?? []) if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    if (data.length < 1000) break;
  }
  const tags = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return NextResponse.json({ tags });
}
