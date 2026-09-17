import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { brevoGet, section, type Section } from "@/lib/brevo";
import { getBrevoSettings } from "@/lib/brevo-settings";
import { runBrevoEvents, type EventsRunResult } from "@/lib/brevo-events";

// Automations tab: event pipeline status.
//   GET  -> settings flags, recent claims (sent/failed), counts, Brevo's own event log
//   POST -> (admin) dry run: which events the next tick would send, and why others are skipped
export const dynamic = "force-dynamic";

type Claim = { order_id: string; event_name: string; email: string | null; status: string; error: string | null; created_at: string };
type BrevoLoggedEvent = { event_name?: string; event_date?: string; contact_id?: number; email?: string; identifiers?: Record<string, unknown> };

export type AutomationsResponse = {
  eventsEnabled: boolean;
  target: "test" | "live";
  migrated: boolean;
  counts: { sent7d: number; failed7d: number; byEvent: Record<string, number> };
  recent: Claim[];
  brevoLog: Section<{ count: number; events: BrevoLoggedEvent[] }>;
};

export async function GET() {
  const settings = await getBrevoSettings();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [claims, brevoLog] = await Promise.all([
    settings.migrated
      ? supabaseAdmin.from("brevo_event_claims").select("order_id, event_name, email, status, error, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as Claim[], error: null }),
    section(brevoGet<{ count?: number; events?: BrevoLoggedEvent[] }>("/events?limit=20&sort=desc").then((r) => ({ count: r.count ?? 0, events: r.events ?? [] }))),
  ]);
  const rows = (claims.data ?? []) as Claim[];
  const byEvent: Record<string, number> = {};
  for (const r of rows) if (r.status === "sent") byEvent[r.event_name] = (byEvent[r.event_name] ?? 0) + 1;
  const body: AutomationsResponse = {
    eventsEnabled: settings.events_enabled,
    target: settings.sync_target,
    migrated: settings.migrated,
    counts: { sent7d: rows.filter((r) => r.status === "sent").length, failed7d: rows.filter((r) => r.status === "failed").length, byEvent },
    recent: rows.slice(0, 50),
    brevoLog,
  };
  return NextResponse.json(body);
}

export async function POST() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  try {
    const r: EventsRunResult = await runBrevoEvents({ dryRun: true });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "dry run failed" }, { status: 500 });
  }
}
