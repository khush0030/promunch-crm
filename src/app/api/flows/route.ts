import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("flows")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ flows: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, trigger_type } = body;
  if (!name) return NextResponse.json({ error: "Flow name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("flows")
    .insert({
      name,
      trigger_type: trigger_type || "customer_created",
      status: "draft",
      steps: [],
      revenue_attributed: 0,
      total_entered: 0,
      total_converted: 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ flow: data }, { status: 201 });
}
