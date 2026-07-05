import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";

// Vercel BotID guard for sensitive, browser-initiated mutation routes (audit
// M1). Returns a 403 NextResponse when the caller is classified as a bot, or
// null to proceed. Paths guarded here MUST also be listed in
// instrumentation-client.ts's initBotId({ protect }) or checkBotId() fails.
//
// Local dev + non-Vercel always returns isBot:false, so this is a no-op outside
// production. Basic checks are free; Deep Analysis (dashboard opt-in) is billed.
export async function assertHuman(): Promise<NextResponse | null> {
  try {
    const { isBot } = await checkBotId();
    if (isBot) {
      return NextResponse.json({ error: "Automated request blocked." }, { status: 403 });
    }
  } catch {
    // Never let a BotID hiccup take down a legitimate request — fail open.
  }
  return null;
}
