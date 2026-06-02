// Brand learning corpus — the agent's growing "brain".
//
// Every approved reply and every human feedback correction is distilled into
// a brand_knowledge row. getBrandExamples() pulls the most recent rows back
// into the system prompt as few-shot exemplars so the agent's voice and
// policies converge on PROMUNCH's house style over time.
//
// All writes are best-effort: learning must never break the send pipeline.

import { db } from "./supabase.ts";

const MAX_EXCERPT = 1200;
const MAX_REPLY = 1500;
// Hard cap on how much of the shared knowledge base we prompt-stuff into the
// email system prompt. Mirrors wa-ai-reply's KB_CHAR_BUDGET so both channels
// draw on the same brand KB without blowing up the context.
const KB_CHAR_BUDGET = 12000;

export async function recordApprovedReply(opts: {
  threadId: string;
  subject: string | null;
  inboundExcerpt: string;
  finalReply: string;
}): Promise<void> {
  try {
    await db().from("brand_knowledge").insert({
      kind: "approved_reply",
      inbound_subject: opts.subject,
      inbound_excerpt: (opts.inboundExcerpt ?? "").slice(0, MAX_EXCERPT),
      final_reply: (opts.finalReply ?? "").slice(0, MAX_REPLY),
      source_thread_id: opts.threadId,
    });
  } catch (e) {
    console.warn("brand_knowledge approved_reply insert failed:", e);
  }
}

export async function recordFeedback(opts: {
  threadId: string;
  subject: string | null;
  feedback: string;
  resultingReply: string;
}): Promise<void> {
  try {
    await db().from("brand_knowledge").insert({
      kind: "feedback_pattern",
      inbound_subject: opts.subject,
      feedback: opts.feedback,
      final_reply: (opts.resultingReply ?? "").slice(0, MAX_REPLY),
      source_thread_id: opts.threadId,
    });
  } catch (e) {
    console.warn("brand_knowledge feedback_pattern insert failed:", e);
  }
}

// Returns sender-domain / pattern hints distilled from past human Skips,
// so the classifier learns which mail not to reply to.
export async function getNoReplyExamples(limit = 25): Promise<string> {
  try {
    const supabase = db();
    const { data } = await supabase
      .from("brand_knowledge")
      .select("inbound_subject, inbound_excerpt, feedback")
      .eq("kind", "feedback_pattern")
      .ilike("feedback", "%no_reply%")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data?.length) return "";
    const lines: string[] = [];
    for (const r of data as Array<{ inbound_subject: string | null; inbound_excerpt: string | null }>) {
      const sub = (r.inbound_subject ?? "").slice(0, 80);
      const exc = (r.inbound_excerpt ?? "").slice(0, 120);
      if (!sub && !exc) continue;
      lines.push(`- subject="${sub}" snippet="${exc}"`);
    }
    return lines.join("\n");
  } catch (e) {
    console.warn("getNoReplyExamples failed:", e);
    return "";
  }
}

// Returns the shared brand knowledge base — the same kb_documents the WhatsApp
// agent reads — as a single prompt-ready string, capped to KB_CHAR_BUDGET.
// This is the canonical "knowledge base about the brand" (FSSAI, products,
// pricing, addresses) so email drafts answer factual questions, not just
// mirror voice. Returns "" if none/unavailable.
export async function getKnowledgeBase(): Promise<string> {
  try {
    const { data: docs } = await db()
      .from("kb_documents")
      .select("name, raw_text")
      .eq("status", "ready");
    let kb = (docs ?? [])
      .filter((d) => d.raw_text && String(d.raw_text).trim())
      .map((d) => `## ${d.name}\n${d.raw_text}`)
      .join("\n\n");
    if (kb.length > KB_CHAR_BUDGET) kb = kb.slice(0, KB_CHAR_BUDGET);
    return kb;
  } catch (e) {
    console.warn("getKnowledgeBase failed:", e);
    return "";
  }
}

// Returns a prompt-ready string of learned context, or "" if none/unavailable.
export async function getBrandExamples(limit = 6): Promise<string> {
  try {
    const supabase = db();
    const [kb, { data: approved }, { data: feedback }, { data: facts }] = await Promise.all([
      getKnowledgeBase(),
      supabase
        .from("brand_knowledge")
        .select("inbound_subject, inbound_excerpt, final_reply")
        .eq("kind", "approved_reply")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("brand_knowledge")
        .select("feedback, final_reply")
        .eq("kind", "feedback_pattern")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("brand_knowledge")
        .select("inbound_excerpt")
        .eq("kind", "brand_fact")
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    const blocks: string[] = [];

    if (kb) {
      blocks.push(
        "KNOWLEDGE BASE (authoritative brand facts — products, pricing, " +
          "policies, addresses, FSSAI/legal. Answer factual questions from " +
          "this; never invent details not found here):\n" +
          kb,
      );
    }

    if (facts?.length) {
      blocks.push("Brand facts (always honour these):");
      for (const f of facts) {
        if (f.inbound_excerpt) blocks.push(`- ${f.inbound_excerpt}`);
      }
    }

    if (approved?.length) {
      blocks.push(
        "\nPast approved replies — mirror this voice, structure, length, and level of detail:",
      );
      for (const a of approved) {
        blocks.push(
          `<example>\nInbound subject: ${a.inbound_subject ?? "(none)"}\n` +
            `Inbound: ${a.inbound_excerpt ?? ""}\n` +
            `Approved reply:\n${a.final_reply ?? ""}\n</example>`,
        );
      }
    }

    if (feedback?.length) {
      blocks.push(
        "\nHuman feedback corrections applied previously — internalize these as standing rules:",
      );
      for (const f of feedback) {
        blocks.push(
          `- When a reviewer said "${f.feedback}", the corrected reply looked like:\n` +
            `${(f.final_reply ?? "").slice(0, 600)}`,
        );
      }
    }

    return blocks.join("\n");
  } catch (e) {
    console.warn("getBrandExamples failed:", e);
    return "";
  }
}
