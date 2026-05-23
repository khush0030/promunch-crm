import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "25"));
  const status = searchParams.get("status") || "";
  const search = searchParams.get("search") || "";
  const leadCategory = searchParams.get("lead_category") || "";

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabaseAdmin
    .from("email_threads")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) q = q.eq("status", status);
  if (leadCategory) q = q.eq("lead_category", leadCategory);
  if (search) q = q.or(`from_email.ilike.%${search}%,from_name.ilike.%${search}%,subject.ilike.%${search}%`);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    threads: data || [],
    total: count || 0,
    page,
    pages: Math.max(1, Math.ceil((count || 0) / limit)),
  });
}
