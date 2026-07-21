// Follow-up draft generator for the Instagram follow-up engine.
//
// NOT ig-ai-reply: that answers an inbound message. This writes a proactive
// nudge for a collab thread that went quiet — grounded in the stage goal, the
// agreed barter terms, and the recent conversation. Tone softens with the step
// number: friendly → checking in → last gentle nudge with an easy out.

import OpenAI from "npm:openai@4.78.0";
import { db } from "./supabase.ts";

const MODEL = Deno.env.get("IG_AI_MODEL") ?? "gpt-4o-mini";

export interface FollowupDraftInput {
  handle: string | null;
  stage: string;
  goal: string;
  step: number;          // 1-based
  totalSteps: number;
  daysSilent: number;
  collabDraft: string | null;   // the terms we proposed / agreed
  barterTerms: string | null;
  lastMessages: { direction: string; text: string | null }[];
}

export async function generateFollowupDraft(input: FollowupDraftInput): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const isLast = input.step >= input.totalSteps;
  const convo = input.lastMessages
    .map((m) => `${m.direction === "inbound" ? "THEM" : "US"}: ${(m.text ?? "").slice(0, 160)}`)
    .join("\n");

  const sys =
    `You write short Instagram DMs for PROMUNCH (Indian healthy-snack brand, "Your Munchy Pal") nudging an ` +
    `influencer collab forward.\n` +
    `BRAND COPY RULES (strict): always write "PROMUNCH" in all caps. NEVER use em dashes or en dashes; use ` +
    `commas or full stops. Warm, human, never pushy or guilt-trippy. Under 400 characters. Plain text, no ` +
    `markdown. Do not invent facts, discounts or deadlines that are not in the context below.`;
  const user = [
    `CONTEXT`,
    `Creator: ${input.handle ? `@${input.handle}` : "(unknown handle)"}`,
    `Pipeline stage: ${input.stage} — goal of this nudge: ${input.goal}`,
    `Days since their last reply: ${input.daysSilent}`,
    `Nudge ${input.step} of ${input.totalSteps}${isLast ? " (FINAL — include a friendly easy out, e.g. no worries if now is not a good time)" : ""}`,
    input.collabDraft ? `What we proposed/agreed:\n${input.collabDraft.slice(0, 500)}` : null,
    input.barterTerms ? `Our standard barter terms:\n${input.barterTerms.slice(0, 400)}` : null,
    convo ? `Recent conversation (newest last):\n${convo}` : null,
    ``,
    `Write ONLY the DM text, nothing else.`,
  ].filter((l): l is string => l !== null).join("\n");

  const client = new OpenAI({ apiKey });
  const resp = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 220,
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
  });
  const text = (resp.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new Error("empty follow-up draft");
  // brand rule backstop: strip any em/en dashes the model slipped in
  return text.replace(/\s*[—–]\s*/g, ", ").slice(0, 600);
}

export interface CadenceCfg {
  days: number[];
  goal: string;
}

export async function loadCadences(): Promise<Record<string, CadenceCfg>> {
  const { data } = await db().from("ig_settings").select("followup_cadences").eq("id", 1).maybeSingle();
  const raw = (data?.followup_cadences ?? {}) as Record<string, unknown>;
  const out: Record<string, CadenceCfg> = {};
  for (const [stage, cfg] of Object.entries(raw)) {
    const days = Array.isArray((cfg as any)?.days) ? (cfg as any).days.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : [];
    if (days.length) out[stage] = { days, goal: String((cfg as any)?.goal ?? "move the collab forward") };
  }
  return out;
}
