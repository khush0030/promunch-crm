import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Distinct Klaviyo lists & segments across all contacts, with membership
// counts — feeds the Contacts page filter chips. Ordered most-populated first.
export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("klaviyo_lists, klaviyo_segments")
    .limit(50000);

  if (error) return NextResponse.json({ lists: [], segments: [] });

  const lists = new Map<string, number>();
  const segments = new Map<string, number>();
  for (const row of data ?? []) {
    for (const l of ((row.klaviyo_lists ?? []) as string[])) {
      if (l) lists.set(l, (lists.get(l) ?? 0) + 1);
    }
    for (const s of ((row.klaviyo_segments ?? []) as string[])) {
      if (s) segments.set(s, (segments.get(s) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

  return NextResponse.json({ lists: top(lists), segments: top(segments) });
}
