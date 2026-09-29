import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { enrollEmailFlow } from "@/lib/email/enroll";
import {
  browseEntityRef,
  filterEligible,
  pickBrowseCandidates,
  MAX_VIEW_AGE_HOURS,
  ORDER_LOOKBACK_DAYS,
  REPEAT_COOLDOWN_DAYS,
  type ContactConsent,
  type StorefrontEventRow,
} from "@/lib/email/browse-abandon";

// Browse-abandonment enrolment, hourly via Supabase pg_cron
// (migration 20260930130000_storefront_events.sql) with the CRON_SECRET bearer;
// fails closed if the secret is unset.
//
// Enrols identified visitors who viewed a product 1-24h ago, then did not add
// to cart, start checkout or order, into the ACTIVE flow whose
// trigger_type = 'segment_entry' and trigger_config.segment = 'browse_abandon'.
// No active browse flow => enrols nobody (the purge still runs).
//
// Never sends here. The email-flow-tick cron sends, taking its email_sends
// claim first (AGENTS.md §4.1). Enrolment is idempotent on
// (flow_id, dedup_key = browse:<contact>:<view day>), so overlapping ticks
// cannot double-enrol; the 7-day cooldown is an extra guard on top.
//
// Also purges storefront_events older than 90 days.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PAGE = 1000;
const MAX_EVENTS = 50_000;
const MAX_ENROLS_PER_TICK = 200;
const RETENTION_DAYS = 90;
const DAY = 86_400_000;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function purgeOld(now: number): Promise<number | null> {
  const { error, count } = await supabase
    .from("storefront_events")
    .delete({ count: "exact" })
    .lt("created_at", new Date(now - RETENTION_DAYS * DAY).toISOString());
  if (error) {
    console.error("email_browse_purge_failed", { message: error.message });
    return null;
  }
  return count ?? 0;
}

async function findBrowseFlow(): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("flows")
    .select("id, trigger_config, created_at")
    .eq("trigger_type", "segment_entry")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`flows: ${error.message}`);
  const f = (data ?? []).find((r) => (r.trigger_config as Record<string, unknown> | null)?.segment === "browse_abandon");
  return f ? { id: f.id as string } : null;
}

async function loadRecentEvents(now: number): Promise<StorefrontEventRow[]> {
  const since = new Date(now - MAX_VIEW_AGE_HOURS * 3_600_000).toISOString();
  const rows: StorefrontEventRow[] = [];
  for (let from = 0; from < MAX_EVENTS; from += PAGE) {
    const { data, error } = await supabase
      .from("storefront_events")
      .select("client_id, contact_id, email, event, product, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`storefront_events: ${error.message}`);
    rows.push(...((data ?? []) as StorefrontEventRow[]));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

async function tick() {
  const now = Date.now();
  const purged = await purgeOld(now);

  const flow = await findBrowseFlow();
  if (!flow) return { purged, flow: null, candidates: 0, attempted: 0 };

  const events = await loadRecentEvents(now);
  const candidates = pickBrowseCandidates(events, now);
  if (candidates.length === 0) return { purged, flow: flow.id, candidates: 0, attempted: 0 };

  const emails = [...new Set(candidates.map((c) => c.email))];
  const contactsByEmail = new Map<string, ContactConsent>();
  const orderedEmails = new Set<string>();
  const suppressed = new Set<string>();
  const orderSince = new Date(now - ORDER_LOOKBACK_DAYS * DAY).toISOString();

  for (const batch of chunk(emails, 200)) {
    const [c, o, s] = await Promise.all([
      supabase.from("contacts").select("id, email, first_name, status, accepts_marketing, email_consent").in("email", batch),
      supabase.from("shopify_orders").select("customer_email").in("customer_email", batch).gte("shopify_created_at", orderSince),
      supabase.from("suppressions").select("email").in("email", batch),
    ]);
    if (c.error) throw new Error(`contacts: ${c.error.message}`);
    if (o.error) throw new Error(`shopify_orders: ${o.error.message}`);
    if (s.error) throw new Error(`suppressions: ${s.error.message}`);
    for (const r of c.data ?? []) {
      if (r.email) contactsByEmail.set(String(r.email).toLowerCase(), r as ContactConsent);
    }
    for (const r of o.data ?? []) if (r.customer_email) orderedEmails.add(String(r.customer_email).toLowerCase());
    for (const r of s.data ?? []) if (r.email) suppressed.add(String(r.email).toLowerCase());
  }

  const contactIds = [...new Set([...contactsByEmail.values()].map((c) => c.id))];
  const recentlyEnrolledContactIds = new Set<string>();
  const cooldownSince = new Date(now - REPEAT_COOLDOWN_DAYS * DAY).toISOString();
  for (const batch of chunk(contactIds, 200)) {
    const { data, error } = await supabase
      .from("flow_enrollments")
      .select("contact_id")
      .eq("flow_id", flow.id)
      .in("contact_id", batch)
      .gte("entered_at", cooldownSince);
    if (error) throw new Error(`flow_enrollments: ${error.message}`);
    for (const r of data ?? []) if (r.contact_id) recentlyEnrolledContactIds.add(r.contact_id as string);
  }

  const eligible = filterEligible(candidates, { contactsByEmail, suppressed, orderedEmails, recentlyEnrolledContactIds });

  let attempted = 0;
  for (const e of eligible.slice(0, MAX_ENROLS_PER_TICK)) {
    try {
      // `flowId` pins the enrolment to the browse flow; without it the
      // oldest active segment_entry flow (win-back etc.) would be picked.
      await enrollEmailFlow("segment_entry", {
        email: e.email,
        entityRef: browseEntityRef(e.contactId, e.viewedAt),
        dedupPrefix: "browse",
        firstName: e.firstName,
        flowId: flow.id,
        context: { product: e.product, viewed_at: e.viewedAt },
      });
      attempted += 1; // may be a no-op if the dedup key already exists
    } catch (err) {
      console.error("email_browse_enrol_failed", { contact: e.contactId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { purged, flow: flow.id, events: events.length, candidates: candidates.length, eligible: eligible.length, attempted };
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await tick();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error("email_browse_tick_failed", { message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
