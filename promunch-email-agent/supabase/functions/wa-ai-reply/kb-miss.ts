// Knowledge-gap detection.
//
// The Sep 2026 audit found the bot's most common real failure was not a crash,
// it was answering "I don't have those details, the team will follow up" to
// questions the knowledge base simply did not cover: Rakhi hampers, Beetroot
// Chips, product links, wholesale rates. Finding those took reading two weeks
// of transcripts by hand.
//
// This records one connector event whenever the bot deflects instead of
// answering, with the customer's actual question. The gaps then surface from a
// query instead of from someone re-reading chats:
//
//   select detail->>'question', count(*)
//   from connector_events
//   where connector = 'whatsapp' and event = 'kb_miss'
//     and created_at > now() - interval '7 days'
//   group by 1 order by 2 desc;
//
// Logged at 'warn' on purpose: a knowledge gap is a content backlog item, not
// an outage, so it must never page Slack or flip the WhatsApp status light.

import { logConnector } from "../_shared/connector-log.ts";

// Phrases that mean "I could not answer this". Deliberately narrow: a reply
// that says the team will CALL BACK about a wholesale enquiry is the designed
// behaviour, not a gap, so lead-handling language is excluded below.
const DEFLECTION = [
  /\b(i|we)\s+(don'?t|do not)\s+have\s+(the\s+)?(exact\s+)?(details|info|information|price|pricing)\b/i,
  /\b(i'?m|i am)\s+not\s+sure\b/i,
  /\bdon'?t\s+have\s+that\s+(info|information|detail)/i,
  /\bcan'?t\s+find\s+(that|this|any)\b/i,
  /\b(i'?ll|i will|i'?ve|i have)\s+noted\s+(this|that|it)\b/i,
  /\bteam\s+will\s+(confirm|check|get back|follow up)\b/i,
  /\bnot\s+listed\b/i,
  /\bwe\s+(do not|don'?t)\s+(sell|offer|have)\b/i,
];

// Replies that LOOK like a deflection but are the intended script. A wholesale
// or creator enquiry is supposed to end with "the team will call you back", and
// a food-safety complaint with "the quality team will contact you". Counting
// those as knowledge gaps would bury the real ones.
const BY_DESIGN = [
  /\b(sales|quality|ops)\s+team\b/i,
  /\bcall\s+(you\s+)?back\b/i,
  /\bhello@promunch\.in\b/i,
  /\bwholesale\b/i,
  /\bcollaborat/i,
  /\bpartnership\b/i,
  // Bulk / institutional intake is the designed lead script, not a gap: the
  // bot correctly says we have no retail bulk pack and collects the enquiry.
  /\b(bulk|institutional|distributor|canteen)\b/i,
  /\bbusiness name\b/i,
  // "We don't sell protein powder, our snacks are plant-protein based like
  // roasted edamame" is a COMPLETE answer, not a gap. If the bot named a real
  // product it knew what we sell. This trades some recall for precision on
  // purpose: a review queue full of false positives is a queue nobody reads.
  /\b(crunchies|edamame|soya sticks|soya chips|combo)\b/i,
];

export function isKbMiss(reply: string, hasTicket: boolean): boolean {
  if (!reply) return false;
  // A ticket means the team was genuinely engaged, which is a handled outcome
  // rather than an unanswered question.
  if (hasTicket) return false;
  if (BY_DESIGN.some((r) => r.test(reply))) return false;
  return DEFLECTION.some((r) => r.test(reply));
}

// Fire-and-forget: never let logging affect the customer's reply.
export async function logKbMiss(o: {
  question: string;
  reply: string;
  threadId: string;
  waId: string | null;
}): Promise<void> {
  try {
    await logConnector({
      connector: "whatsapp",
      level: "warn",
      event: "kb_miss",
      ref: o.threadId,
      message: `Bot deflected: "${o.question.slice(0, 160)}"`,
      detail: {
        question: o.question.slice(0, 500),
        reply: o.reply.slice(0, 500),
        thread_id: o.threadId,
        wa_id: o.waId,
      },
    });
  } catch (e) {
    console.warn("[wa-ai-reply] kb_miss log failed", e);
  }
}
