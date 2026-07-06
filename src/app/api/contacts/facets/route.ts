import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Distinct Klaviyo lists & segments across all contacts, with membership
// counts — feeds the Contacts page filter chips. Ordered most-populated first.
// Also returns headline stats for the Contacts page KPI row (one roundtrip).
export const dynamic = "force-dynamic";

export async function GET() {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [facetsRes, totalRes, buyersRes, newMonthRes, unsubRes] = await Promise.all([
    supabaseAdmin.from("contacts").select("klaviyo_lists, klaviyo_segments").limit(50000),
    supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).gt("total_orders", 0),
    supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).gte("created_at", monthStart.toISOString()),
    supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).eq("status", "unsubscribed"),
  ]);

  const stats = {
    total: totalRes.count ?? 0,
    buyers: buyersRes.count ?? 0,
    newThisMonth: newMonthRes.count ?? 0,
    unsubscribed: unsubRes.count ?? 0,
  };

  const { data, error } = facetsRes;
  if (error) return NextResponse.json({ lists: [], segments: [], stats });

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

  return NextResponse.json({ lists: top(lists), segments: top(segments), stats });
}
