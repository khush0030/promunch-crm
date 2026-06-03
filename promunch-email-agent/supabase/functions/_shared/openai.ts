// Email draft generation — OpenAI Chat Completions.
//
// Replaces the prior Anthropic helper. Exported signature is unchanged so
// callers (process-email, slack-events, slack-interactivity) don't move.
// Default model is gpt-4o-mini — roughly 1/20th the cost of Sonnet for the
// drafting workload. Bump OPENAI_MODEL to "gpt-4o" if quality drops.

import OpenAI from "npm:openai@4.78.0";
import { getBrandExamples } from "./brand.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: OPENAI_API_KEY });
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
- Sign off as "Team PROMUNCH" unless the email is clearly addressed to a specific person. End every reply with the brand tagline "Your Munchy Pal 💚" on its own line, right under the sign-off.
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

  const resp = await client().chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage },
    ],
  });

  const body = (resp.choices[0]?.message?.content ?? "").trim();
  if (!body) throw new Error("OpenAI returned no draft text");
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
