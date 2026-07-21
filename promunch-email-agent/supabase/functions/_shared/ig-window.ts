// Meta Instagram messaging-window state machine.
//
// Meta's rules for DMs from a business account:
//   • free-form DM only within 24h of the user's LAST INBOUND message
//   • the HUMAN_AGENT message tag extends that to 7 days, but requires a
//     separate Meta app-review approval AND a human in the loop — we only use
//     it for human-approved sends from the Tasks tab
//   • outside both: no API send path exists (fallback = email / WhatsApp /
//     manual send from the app)
//
// ig-send enforces this as a hard guard; ig-followup-tick uses it to route a
// due follow-up to auto-send vs the approval queue.

export type WindowState = "open_24h" | "human_agent_7d" | "closed";

const H24 = 24 * 3600_000;
const D7 = 7 * 24 * 3600_000;

export function windowState(lastInboundAt: string | null, humanAgentEnabled: boolean): WindowState {
  if (!lastInboundAt) return "closed"; // never inbound → no DM path exists at all
  const age = Date.now() - new Date(lastInboundAt).getTime();
  if (Number.isNaN(age)) return "closed";
  if (age < H24) return "open_24h";
  if (humanAgentEnabled && age < D7) return "human_agent_7d";
  return "closed";
}
