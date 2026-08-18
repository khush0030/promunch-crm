import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { parseBody } from "@/lib/api-helpers";
import { supabaseAdmin } from "@/lib/supabase-admin";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Never-message-twice guard for the MANUAL send path (agent-typed chat replies +
// template sends from the inbox, and campaign test-sends). A free-text message
// has no natural claim key, so we synthesise a destination+content hash and take
// an atomic, TIME-WINDOWED claim (claim_manual_send RPC) BEFORE dispatching to
// wa-send. A double-click, a double-Enter, or two agents replying at once all
// collapse to a single send; a genuinely different message — or the same message
// after the window — goes through normally. See migration 010.
const DEDUP_WINDOW_SECONDS = 90;

function dedupKey(body: Record<string, unknown>): string | null {
  const dest = body.thread_id ?? body.to ?? body.wa_id ?? body.phone;
  if (!dest) return null; // no stable destination -> cannot dedup, fail open
  const kind = body.kind === "template" ? "template" : "text";
  const content =
    kind === "template"
      ? JSON.stringify(body.template ?? {})
      : String(body.text ?? "").trim();
  if (!content) return null;
  const h = createHash("sha256").update(`${kind}\n${content}`).digest("hex").slice(0, 32);
  return `manual:${dest}:${h}`;
}

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });

  // Take the atomic windowed claim before dispatching. If we cleanly LOSE it, an
  // identical message to this destination is already in flight / was just sent
  // inside the window -> skip so the customer is not messaged twice. Fail OPEN on
  // any RPC error (a missed dedup is recoverable and beats a stuck inbox — and it
  // keeps working before migration 010 is applied).
  const key = dedupKey(body);
  if (key) {
    const { data: won, error } = await supabaseAdmin.rpc("claim_manual_send", {
      p_key: key,
      p_window_seconds: DEDUP_WINDOW_SECONDS,
    });
    if (!error && won === false) {
      return NextResponse.json({ ok: true, skipped: true, reason: "duplicate" });
    }
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-send`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  // Send did not reach the customer -> release the claim so a retry is not
  // blocked for the rest of the window (no message went out, so it is not a dup).
  const failed = !res.ok || (data as { ok?: boolean; error?: unknown }).ok === false || (data as { error?: unknown }).error;
  if (key && failed) {
    try {
      await supabaseAdmin.rpc("release_manual_send", { p_key: key });
    } catch {
      /* best-effort release; the window will clear it either way */
    }
  }

  return NextResponse.json(data, { status: res.status });
}
