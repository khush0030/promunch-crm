// Maya chat endpoint. Streams a UI-message response from OpenAI with Maya's
// read-only data tools, and persists the full conversation on completion.

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordAudit } from "@/lib/audit";
import { assistantTools } from "@/lib/assistant/tools";
import { buildInstructions } from "@/lib/assistant/prompt";
import { getSecret } from "@/lib/secrets";
import { parseBody } from "@/lib/api-helpers";

export const maxDuration = 120;

const MODEL = process.env.OPENAI_ASSISTANT_MODEL || "gpt-5-mini";
// Cap what we replay to the model; the full conversation still persists in DB.
const MAX_HISTORY = 24;

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n");
}

async function persist(conversationId: string, messages: UIMessage[]) {
  const rows = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      conversation_id: conversationId,
      role: m.role,
      content: textOf(m),
      meta: {
        tools: m.parts
          .filter((p) => p.type.startsWith("tool-"))
          .map((p) => ({ type: p.type, state: (p as { state?: string }).state ?? null })),
      },
    }))
    .filter((r) => r.content || r.meta.tools.length);

  // Rewrite the whole conversation each turn: idempotent, and immune to
  // message-id drift between client reloads.
  await supabaseAdmin.from("assistant_messages").delete().eq("conversation_id", conversationId);
  if (rows.length) await supabaseAdmin.from("assistant_messages").insert(rows);

  const firstUser = rows.find((r) => r.role === "user")?.content?.slice(0, 80) || "New conversation";
  await supabaseAdmin
    .from("assistant_conversations")
    .update({ title: firstUser })
    .eq("id", conversationId)
    .is("title", null);
  await supabaseAdmin
    .from("assistant_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await parseBody<{ messages?: UIMessage[]; conversationId?: string }>(req);
  if (!body) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { messages, conversationId } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  // The client creates the conversation before sending; this is a safety net
  // so history is never dropped if it didn't.
  let convoId = conversationId ?? null;
  if (!convoId) {
    const { data } = await supabaseAdmin
      .from("assistant_conversations")
      .insert({ created_by: user.email ?? null })
      .select("id")
      .single();
    convoId = data?.id ?? null;
  }

  const trimmed = messages.slice(-MAX_HISTORY);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  await recordAudit({
    action: "assistant.chat",
    entityType: "assistant_conversation",
    entityId: convoId ?? undefined,
    summary: lastUser ? textOf(lastUser).slice(0, 140) : undefined,
    actor: user,
  });

  // Key resolves through Settings → API keys with env fallback, so the owner
  // can rotate it without a redeploy.
  const openai = createOpenAI({ apiKey: (await getSecret("OPENAI_API_KEY")) ?? undefined });

  const result = streamText({
    model: openai(MODEL),
    instructions: buildInstructions(),
    messages: await convertToModelMessages(trimmed),
    tools: assistantTools,
    stopWhen: stepCountIs(10),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: trimmed,
      onEnd: async ({ messages: finalMessages }) => {
        if (!convoId) return;
        try {
          await persist(convoId, finalMessages);
        } catch (e) {
          console.error("[assistant] failed to persist conversation", convoId, e);
        }
      },
    }),
  });
}
