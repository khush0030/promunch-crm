// Fire-and-forget nudge to deal-scan when new mail lands, so the deal
// pipeline syncs on arrival instead of waiting for the 30-min cron.
// Never throws — a failed nudge only delays sync until the next cron tick.

import { errStr, logConnector } from "./connector-log.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

export function nudgeDealScan(source: string): void {
  const p = trigger(source);
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(p);
  }
  // no await on purpose; the promise carries its own error handling
}

async function trigger(source: string): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const resp = await fetch(`${url}/functions/v1/deal-scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: source }),
    });
    if (!resp.ok) throw new Error(`deal-scan returned ${resp.status}: ${await resp.text()}`);
  } catch (e) {
    await logConnector({
      connector: "deal_scan",
      level: "warn",
      event: "trigger_failed",
      message: `deal-scan nudge from ${source} failed: ${errStr(e).slice(0, 300)}`,
      throttleMinutes: 60,
    });
  }
}
