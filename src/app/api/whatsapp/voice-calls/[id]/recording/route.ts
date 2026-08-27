import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchRecording } from "@/lib/sarvam-voice";

export const dynamic = "force-dynamic";

// Proxies a call's recording out of Sarvam's analytics API. This route is the
// ENTIRE reason src/lib/sarvam-voice.ts's API key never has to leave the
// server: the browser's <audio> element hits this route, never Sarvam
// directly, so SARVAM_VOICE_API_KEY is never present in any response the
// client can read.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const { data: call, error } = await supabaseAdmin
    .from("voice_calls")
    .select("id, interaction_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!call || !call.interaction_id) {
    return NextResponse.json({ error: "no recording for this call" }, { status: 404 });
  }

  const recording = await fetchRecording(call.interaction_id);
  if (!recording) {
    return NextResponse.json({ error: "recording unavailable upstream" }, { status: 502 });
  }

  return new NextResponse(recording.body, {
    status: 200,
    headers: {
      "content-type": recording.contentType || "audio/wav",
      "cache-control": "private, max-age=3600",
    },
  });
}
