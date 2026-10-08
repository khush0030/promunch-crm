import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getFullKnowledgeBase } from "@/lib/leads/kb";
import { getSecret } from "@/lib/secrets";
import { jsonError, requireUser, UUID_RE } from "@/lib/orm/db";
import { buildReplyUserPrompt, cleanReply, REPLY_MODEL, REPLY_SYSTEM_PROMPT, type ReplyInput } from "@/lib/orm/reply";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/orm/mentions/[id]/draft
// AI-drafts a public reply grounded in the Master KB (kb_documents), applies
// the brand rules in code, saves it as reply_draft. Posts nothing: a teammate
// edits, copies and posts it by hand.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError("mention not found", 404);

  const { data: m } = await supabaseAdmin
    .from("orm_mentions")
    .select("source, author_name, author_handle, title, body, rating, summary, intent, product, is_owned")
    .eq("id", id)
    .maybeSingle();
  if (!m) return jsonError("mention not found", 404);

  const apiKey = await getSecret("OPENAI_API_KEY");
  if (!apiKey) return jsonError("OPENAI_API_KEY is not configured", 500);
  const kb = await getFullKnowledgeBase();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: REPLY_MODEL,
      max_tokens: 300,
      temperature: 0.5,
      messages: [
        { role: "system", content: REPLY_SYSTEM_PROMPT },
        { role: "user", content: buildReplyUserPrompt(m as ReplyInput, kb) },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return jsonError(err?.error?.message ?? `OpenAI HTTP ${res.status}`, 502);
  }
  const data = await res.json();
  const draft = cleanReply(String(data.choices?.[0]?.message?.content ?? ""));
  if (!draft) return jsonError("The AI did not write a reply. Try again.", 502);

  const { error } = await supabaseAdmin
    .from("orm_mentions")
    .update({ reply_draft: draft, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ draft });
}
