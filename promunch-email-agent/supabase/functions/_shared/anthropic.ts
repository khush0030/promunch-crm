// Claude draft generation — uses the Anthropic SDK in agent-style mode.
//
// We use the standard @anthropic-ai/sdk (works in Deno via npm: imports).
// The "agent" qualities here are:
//   - a long, persona-aware system prompt (acts as ProMunch's email assistant)
//   - structured input (separating the email + prior draft + user feedback)
//   - a follow-up loop driven by Slack thread replies (the loop lives in
//     slack-events; this module just produces one revision per call)
//
// To upgrade to the full Claude Agent SDK (tool use, MCP), swap the
// `messages.create` call for `Agent.run` with tool definitions. The function
// signatures here stay the same.

import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
import { getBrandExamples } from "./brand.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return _client;
}

// ---------------------------------------------------------------------------
// System prompt — the ProMunch persona, drafting style, and guardrails.
// Edit this to tune voice/tone without touching code.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the email assistant for PROMUNCH (a snack brand under Vippy Industries Limited, "Your Munchy Pal"). The inbox you are drafting on behalf of is hello@promunch.in.

Your job is to draft warm, professional, on-brand reply emails to incoming messages.

Voice and style guidelines:
- Friendly, concise, never corporate-stiff. PROMUNCH is a fun snack brand.
- Address the sender by first name when known.
- Sign off as "Team PROMUNCH" unless the email is clearly addressed to a specific person.
- Indian English conventions. No "y'all", no "awesome sauce".
- Be specific and helpful. If the customer is asking about an order, tracking, ingredients, distribution, or a partnership, address their actual question — don't reply with empty platitudes.
- If you do not have enough information to answer (e.g., they ask about a specific order ID and you have no order data), draft a reply that politely asks for the missing detail.
- Keep replies short: 2-5 short paragraphs typically. No long sales pitches.

Output format:
- Reply with ONLY the body of the email reply. No subject line. No "Here's a draft:" preamble. No code fences. Just the email body, ready to send.

Context the user may rely on:
- Product line: protein-rich munchies, edamame, healthier snack alternatives.
- Shipping: Shree Maruti Courier via Shopify, mostly under 1,000 orders/month.
- Customer can track their order at track.promunch.in (when ready).
- Legal entity is Vippy Industries Limited; use that only for formal/legal emails.

If a revision is requested, you will be given the previous draft AND the user's feedback. Apply the feedback faithfully — the user is the human-in-the-loop and their direction overrides your default judgment.`;

// ---------------------------------------------------------------------------
// Draft generation
// ---------------------------------------------------------------------------
export interface DraftInput {
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  body: string;                        // plain text of incoming email

  priorDraft?: string | null;          // present on revisions
  feedback?: string | null;            // user's Slack-thread feedback
}

export async function generateDraft(input: DraftInput): Promise<{ body: string; model: string }> {
  const userMessage = buildUserMessage(input);

  // Pull the agent's learned brand context (past approved replies + human
  // feedback corrections) and append it to the static persona. This is what
  // makes the agent get smarter and converge on PROMUNCH's voice over time.
  const learned = await getBrandExamples();
  const system = learned
    ? `${SYSTEM_PROMPT}\n\n---\nLEARNED BRAND CONTEXT (distilled from past approved replies and human feedback in this very inbox — treat as ground truth for voice, structure, and policy; it overrides generic instincts):\n${learned}`
    : SYSTEM_PROMPT;

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  // Take the first text block from Claude's response
  const textBlock = resp.content.find((b) => b.type === "text");
  const body = textBlock && "text" in textBlock ? textBlock.text.trim() : "";

  if (!body) {
    throw new Error("Claude returned no draft text");
  }
  return { body, model: MODEL };
}

function buildUserMessage(input: DraftInput): string {
  const sections: string[] = [];

  sections.push(`<incoming_email>
From: ${input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail}
Subject: ${input.subject ?? "(no subject)"}

${input.body}
</incoming_email>`);

  if (input.priorDraft) {
    sections.push(`<prior_draft>
${input.priorDraft}
</prior_draft>`);
  }

  if (input.feedback) {
    sections.push(`<user_feedback>
${input.feedback}
</user_feedback>

Revise the prior draft to address this feedback. Output only the new email body.`);
  } else {
    sections.push("Draft a reply to the email above. Output only the email body.");
  }

  return sections.join("\n\n");
}
