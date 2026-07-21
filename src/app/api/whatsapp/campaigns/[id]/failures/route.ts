import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { classifyWaError } from "@/components/whatsapp/waErrors";

export const dynamic = "force-dynamic";

// Per-campaign failure breakdown: every failed send grouped by WHY it failed,
// in plain English, with whether the engine retries it by itself. Answers
// "2,705 failed — what does that mean and what do I do?" without opening the
// raw recipient list.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const rows: { error: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("wa_messages")
      .select("error")
      .eq("campaign_id", id)
      .eq("status", "failed")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    rows.push(...(data as { error: string | null }[]));
    if (data.length < 1000) break;
  }

  const groups = new Map<string, {
    key: string; title: string; msg: string; willRetry: boolean; action: string | null;
    count: number; sample: string | null;
  }>();
  for (const r of rows) {
    const info = classifyWaError(r.error);
    const g = groups.get(info.key) ?? { ...info, count: 0, sample: null };
    g.count += 1;
    if (!g.sample && r.error) g.sample = r.error;
    groups.set(info.key, g);
  }

  return NextResponse.json({
    total: rows.length,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
  });
}
