import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSecret } from "@/lib/secrets";
import { jsonError, readJson, requireUser, UUID_RE } from "@/lib/orm/db";
import {
  buildJudgemeReplyRequest,
  claimConflictMessage,
  JUDGEME_DEFAULT_SHOP,
  judgemeError,
  judgemeReviewId,
  prepareReplyText,
  replyExternalId,
} from "@/lib/orm/judgeme-reply";
import { MENTION_COLUMNS, type OrmMention } from "@/lib/orm/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/orm/mentions/[id]/reply  { reply: string, retry?: boolean }
// Posts a PUBLIC reply under a Judge.me (website) review, as PROMUNCH.
// Never twice: an orm_reply_claims row (primary key = mention) is inserted
// BEFORE calling Judge.me; a second click gets 409. A failed post keeps its
// claim as 'failed'; only an explicit Try again (retry: true) deletes a FAILED
// claim and posts once more. A claim stuck in 'claimed' is never retried here.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError("mention not found", 404);
  const body = await readJson(req);
  if (!body) return jsonError("bad json");
  const prepared = prepareReplyText(body.reply);
  if (!prepared.ok) return jsonError(prepared.error);

  const { data: m, error: mErr } = await supabaseAdmin
    .from("orm_mentions")
    .select("id, source, external_id, status")
    .eq("id", id)
    .maybeSingle();
  if (mErr) return jsonError(mErr.message, 500);
  if (!m) return jsonError("mention not found", 404);
  if (m.source !== "judgeme") return jsonError("Only website (Judge.me) reviews can be answered from here");
  const reviewId = judgemeReviewId(m.external_id);
  if (!reviewId) return jsonError("This review has no Judge.me id, reply on the website instead");

  const token = await getSecret("JUDGEME_API_TOKEN");
  if (!token) return jsonError("Judge.me is not connected. Paste the key in Settings, API keys.");
  const shop = (await getSecret("JUDGEME_SHOP_DOMAIN")) || process.env.JUDGEME_SHOP_DOMAIN || JUDGEME_DEFAULT_SHOP;

  // Explicit Try again: clear a FAILED claim only (never a posted/claimed one).
  if (body.retry === true) {
    const { error } = await supabaseAdmin.from("orm_reply_claims").delete().eq("mention_id", id).eq("status", "failed");
    if (error) return jsonError(error.message, 500);
  }

  // Claim first. 23505 = someone already replied (or is replying) to this one.
  const claim = await supabaseAdmin
    .from("orm_reply_claims")
    .insert({ mention_id: id, claimed_by: gate.actor, status: "claimed" });
  if (claim.error) {
    if (claim.error.code === "23505") {
      const { data: cur } = await supabaseAdmin.from("orm_reply_claims").select("status").eq("mention_id", id).maybeSingle();
      return NextResponse.json({ error: claimConflictMessage(cur?.status), claim: cur?.status ?? null }, { status: 409 });
    }
    return jsonError(claim.error.message, 500);
  }

  const { url, init } = buildJudgemeReplyRequest({ shop, token, reviewId, content: prepared.text });
  let status = 0;
  let json: unknown = null;
  let netError: string | null = null;
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    status = res.status;
    json = await res.json().catch(() => null);
  } catch (e) {
    netError = e instanceof Error ? e.message : String(e);
  }

  const now = new Date().toISOString();
  if (netError || status < 200 || status >= 300) {
    // A timeout may still have posted: tell the teammate to look first.
    const msg = netError
      ? "No answer from Judge.me. Check the review on the website before you try again."
      : judgemeError(status, json);
    await supabaseAdmin
      .from("orm_reply_claims")
      .update({ status: "failed", error: (netError ?? msg).slice(0, 500) })
      .eq("mention_id", id);
    console.warn("orm_judgeme_reply_failed", { id, status, netError });
    return NextResponse.json({ error: msg, claim: "failed" }, { status: 502 });
  }

  const extId = replyExternalId(json);
  await supabaseAdmin.from("orm_reply_claims").update({ status: "posted", posted_at: now, error: null }).eq("mention_id", id);
  const { data, error } = await supabaseAdmin
    .from("orm_mentions")
    .update({
      status: "replied",
      reply_text: prepared.text,
      replied_at: now,
      replied_by: gate.actor,
      reply_channel: "judgeme_api",
      reply_external_id: extId,
      updated_at: now,
    })
    .eq("id", id)
    .select(MENTION_COLUMNS)
    .maybeSingle();
  // The reply IS public now; a ledger write error must not invite a second post.
  if (error) console.error("orm_judgeme_reply_mark_failed", { id, error: error.message });
  console.info("orm_judgeme_reply_posted", { id, by: gate.actor });
  return NextResponse.json({ ok: true, claim: "posted", mention: (data ?? null) as unknown as OrmMention | null });
}
