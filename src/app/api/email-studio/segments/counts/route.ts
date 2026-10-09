import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { parseRules, PRESETS } from "@/lib/email-studio/segments";
import { countAudiences } from "@/lib/email-studio/audience-server";

// Live member counts for every quick segment and saved segment, in one pass
// (Customers → Segments). Read-only: nothing is written, not even the saved
// segment's last_count. Session-gated by the middleware; mapped to the Email
// marketing area through the /api/email-studio prefix in src/lib/access.ts.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { data: saved } = await supabase.from("email_segments").select("id, rules").limit(200);
  const presetKeys = Object.keys(PRESETS);
  const savedRows = (saved ?? []) as { id: string; rules: unknown }[];
  try {
    const counts = await countAudiences([
      ...presetKeys.map((k) => PRESETS[k].rules),
      ...savedRows.map((s) => parseRules(s.rules)),
    ]);
    return NextResponse.json({
      countedAt: new Date().toISOString(),
      presets: Object.fromEntries(presetKeys.map((k, i) => [k, counts[i]])),
      saved: Object.fromEntries(savedRows.map((s, i) => [s.id, counts[presetKeys.length + i]])),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "count failed" }, { status: 500 });
  }
}
