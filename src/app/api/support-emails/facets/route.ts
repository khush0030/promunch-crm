import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Support Emails filter facets: the count of emails still awaiting a reply
// (status = pending) plus the distinct lead_category values with counts.
export const dynamic = "force-dynamic";

export async function GET() {
  const [pendingRes, catRes] = await Promise.all([
    supabaseAdmin
      .from("email_threads")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabaseAdmin.from("email_threads").select("lead_category").limit(50000),
  ]);

  const categories = new Map<string, number>();
  for (const row of catRes.data ?? []) {
    const c = (row as { lead_category: string | null }).lead_category;
    if (c) categories.set(c, (categories.get(c) ?? 0) + 1);
  }

  return NextResponse.json({
    pending: pendingRes.count ?? 0,
    categories: [...categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
  });
}
