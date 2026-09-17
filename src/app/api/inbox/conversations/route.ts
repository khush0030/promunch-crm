import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sanitizeSearch } from "@/lib/api-helpers";
import { getCaller } from "@/lib/rbac-server";
import {
  type InboxFilter,
  type InboxItem,
  type WaThreadRow,
  type IgThreadRow,
  type EmailThreadRow,
  waToItem,
  igToItem,
  emailToItem,
  matchesFilter,
} from "@/lib/inbox/conversations";
import { waSearchOr, igSearchOr, emSearchOr } from "@/lib/inbox/search";
import { parseCursor, isAfterCursor, pageFromChannels, type Cursor } from "@/lib/inbox/cursor";

// GET /api/inbox/conversations — unified read-only list across WhatsApp,
// Instagram and support-email threads for the Inbox hub (Task 2.3). Never
// writes; see the peek-read (`?peek=1`) addition on the per-thread GET
// routes for how opening a thread from here avoids clearing unread_count.
//
// Fix round 1 (review): filters are now pushed into SQL per channel instead
// of over-fetched-then-filtered-in-memory — the original design could
// silently truncate a page (e.g. filter=human returning 2 of 182 matching
// conversations) whenever a channel's most-recent rows didn't happen to
// match the filter within the fetch window. Counts are now exact `count:
// "exact", head: true` queries per channel per filter, not a 500-row sample.
export const dynamic = "force-dynamic";

type Channel = "wa" | "ig" | "em";
const ALL_CHANNELS: Channel[] = ["wa", "ig", "em"];
const FILTERS: InboxFilter[] = ["human", "mine", "bot", "all"];
const EMAIL_STATUSES = ["pending", "sent", "skipped", "failed"];

const WA_COLUMNS =
  "id, status, assigned_to, ticket_status, ticket_number, ticket_assignee, unread_count, last_message_snippet, last_activity_at, created_at, archived_at, contact:wa_contacts!inner(name, phone, wa_id)";
const IG_COLUMNS =
  "id, status, classification, handle, full_name, ticket_status, assigned_to, unread_count, last_message_snippet, last_activity_at, archived_at";
const EM_COLUMNS =
  "id, status, should_reply, from_name, from_email, subject, lead_category, urgency, created_at";

// counts cache: 30s TTL, keyed by requester + channel scope + search text so
// different tabs/searches never share stale numbers with each other.
const countsCache = new Map<string, { ts: number; counts: Record<InboxFilter, number> }>();
const COUNTS_TTL_MS = 30_000;

function pruneCountsCache(now: number) {
  for (const [key, entry] of countsCache) {
    if (now - entry.ts >= COUNTS_TTL_MS) countsCache.delete(key);
  }
}

function parseFilter(raw: string | null): InboxFilter {
  return (FILTERS as string[]).includes(raw ?? "") ? (raw as InboxFilter) : "human";
}

function parseChannels(raw: string | null): Channel[] {
  if (raw === "wa" || raw === "ig" || raw === "em") return [raw];
  return ALL_CHANNELS; // "all", missing, or an invalid value
}

// Minimal structural type every PostgREST filter builder we chain against
// satisfies (select().../order()/limit()/etc. all return `this`). Typed this
// way (instead of `any`) so applyWaFilter/applyIgFilter/applyEmFilter work
// identically against the list query (which also has .order/.limit/.lte) and
// the `count: "exact", head: true` query (which doesn't need those) without
// either duplicating the switch or losing type safety.
type Filterable<Q> = {
  eq(column: string, value: string): Q;
  or(filters: string): Q;
  ilike(column: string, pattern: string): Q;
};

// Pushes each InboxFilter into the exact WHERE clause matchesFilter's
// waToItem-derived rules describe, so the DB only ever returns rows that
// already belong in the requested tab — the over-fetch-and-filter-in-memory
// design this replaces could silently drop pages of results (see the file
// header comment). `matchesFilter` is still re-run over the mapped rows as a
// consistency guard (route body below) in case these two ever diverge.
function applyWaFilter<Q extends Filterable<Q>>(query: Q, filter: InboxFilter, me: string): Q {
  switch (filter) {
    case "human":
      // needsHuman = ticketActive || status === "human"; ticketActive =
      // ticket_status in (open, pending).
      return query.or("status.eq.human,ticket_status.in.(open,pending)");
    case "bot":
      // bot = status === "bot" && !ticketActive. A null ticket_status counts
      // as "not active" — `.not.in` alone would silently exclude NULLs
      // (NULL NOT IN (...) is NULL, not true), so it's spelled out as an
      // explicit `.is.null` OR.
      return query.eq("status", "bot").or("ticket_status.is.null,ticket_status.not.in.(open,pending)");
    case "mine": {
      // assignee = assigned_to ?? ticket_assignee; matchesFilter does a
      // case-insensitive compare, so ilike with no wildcards (exact match,
      // case-insensitive) is the right operator, not an OR of `.eq`s.
      const safeMe = sanitizeSearch(me);
      return query.or(`assigned_to.ilike.${safeMe},ticket_assignee.ilike.${safeMe}`);
    }
    case "all":
    default:
      return query;
  }
}

function applyIgFilter<Q extends Filterable<Q>>(query: Q, filter: InboxFilter, me: string): Q {
  switch (filter) {
    case "human":
      // needsHuman = ticketOpen || status === "human"; ticketOpen =
      // ticket_status === "open".
      return query.or("status.eq.human,ticket_status.eq.open");
    case "bot":
      // bot = status === "bot" && !ticketOpen. Same NULL-safety note as WA.
      return query.eq("status", "bot").or("ticket_status.is.null,ticket_status.neq.open");
    case "mine": {
      const safeMe = sanitizeSearch(me);
      return query.ilike("assigned_to", safeMe);
    }
    case "all":
    default:
      return query;
  }
}

function applyEmFilter<Q extends Filterable<Q>>(query: Q, filter: InboxFilter): Q | null {
  switch (filter) {
    case "human":
      // draftReady = status === "pending" && should_reply !== false.
      return query.eq("status", "pending").or("should_reply.is.null,should_reply.eq.true");
    case "bot":
    case "mine":
      // emailToItem always sets bot=false, assignee=null — these can never
      // match, so skip the query entirely rather than run a doomed one.
      return null;
    case "all":
    default:
      return query;
  }
}

async function fetchWaRows(
  filter: InboxFilter,
  limit: number,
  q: string,
  cursorAt: string | null,
  me: string,
): Promise<WaThreadRow[]> {
  const build = (orderCol: string) => {
    let query = supabaseAdmin
      .from("wa_threads")
      .select(WA_COLUMNS)
      .is("archived_at", null)
      .order(orderCol, { ascending: false, nullsFirst: false })
      .limit(limit);
    if (cursorAt) query = query.lte(orderCol, cursorAt);
    query = applyWaFilter(query, filter, me);
    const orClause = waSearchOr(q);
    if (orClause) query = query.or(orClause);
    return query;
  };

  let { data, error } = await build("last_activity_at");
  if (error?.code === "42703") {
    // Mirrors src/app/api/whatsapp/threads/route.ts's fallback: the
    // generated last_activity_at column hasn't landed on this DB yet.
    ({ data, error } = await build("created_at"));
  }
  if (error) throw new Error(`wa_threads: ${error.message}`);
  return (data ?? []) as unknown as WaThreadRow[];
}

async function countWaFilter(filter: InboxFilter, q: string, me: string): Promise<number> {
  let query = supabaseAdmin
    .from("wa_threads")
    .select("id", { count: "exact", head: true })
    .is("archived_at", null);
  query = applyWaFilter(query, filter, me);
  const orClause = waSearchOr(q);
  if (orClause) query = query.or(orClause);
  const { count, error } = await query;
  if (error) throw new Error(`wa_threads count: ${error.message}`);
  return count ?? 0;
}

// IG failures (missing table, RLS, empty env) degrade to an empty list
// instead of a 500 for the whole route — Instagram is one channel of three.
// Failures are collected on `igIssues` and logged once, at the end of the
// request, by the caller.
async function fetchIgRows(
  filter: InboxFilter,
  limit: number,
  q: string,
  cursorAt: string | null,
  me: string,
  igIssues: string[],
): Promise<IgThreadRow[]> {
  try {
    let query = supabaseAdmin
      .from("ig_threads")
      .select(IG_COLUMNS)
      .is("archived_at", null)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (cursorAt) query = query.lte("last_activity_at", cursorAt);
    query = applyIgFilter(query, filter, me);
    const orClause = igSearchOr(q);
    if (orClause) query = query.or(orClause);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as unknown as IgThreadRow[];
  } catch (err) {
    igIssues.push(err instanceof Error ? err.message : String(err));
    return [];
  }
}

async function countIgFilter(filter: InboxFilter, q: string, me: string, igIssues: string[]): Promise<number> {
  try {
    let query = supabaseAdmin
      .from("ig_threads")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null);
    query = applyIgFilter(query, filter, me);
    const orClause = igSearchOr(q);
    if (orClause) query = query.or(orClause);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  } catch (err) {
    igIssues.push(err instanceof Error ? err.message : String(err));
    return 0;
  }
}

async function fetchEmRows(
  filter: InboxFilter,
  limit: number,
  q: string,
  cursorAt: string | null,
): Promise<EmailThreadRow[]> {
  let query = supabaseAdmin
    .from("email_threads")
    .select(EM_COLUMNS)
    .in("status", EMAIL_STATUSES)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (cursorAt) query = query.lte("created_at", cursorAt);

  const filtered = applyEmFilter(query, filter);
  if (!filtered) return []; // bot/mine can never match email — skip the query
  query = filtered;

  const orClause = emSearchOr(q);
  if (orClause) query = query.or(orClause);

  const { data, error } = await query;
  if (error) throw new Error(`email_threads: ${error.message}`);
  return (data ?? []) as unknown as EmailThreadRow[];
}

async function countEmFilter(filter: InboxFilter, q: string): Promise<number> {
  let query = supabaseAdmin
    .from("email_threads")
    .select("id", { count: "exact", head: true })
    .in("status", EMAIL_STATUSES);

  const filtered = applyEmFilter(query, filter);
  if (!filtered) return 0;
  query = filtered;

  const orClause = emSearchOr(q);
  if (orClause) query = query.or(orClause);

  const { count, error } = await query;
  if (error) throw new Error(`email_threads count: ${error.message}`);
  return count ?? 0;
}

// Consistency guard: SQL is now the source of truth for which rows come
// back, but matchesFilter (the pure, tested rule in conversations.ts) is
// re-run over the mapped items anyway. Anything that fails is dropped and
// logged — SQL and matchesFilter silently diverging would otherwise be
// invisible until someone noticed missing/extra rows in the UI.
function assertMatchesFilter(items: InboxItem[], filter: InboxFilter, me: string): InboxItem[] {
  const kept: InboxItem[] = [];
  for (const item of items) {
    if (matchesFilter(item, filter, me)) {
      kept.push(item);
    } else {
      console.warn(
        `[inbox/conversations] SQL/matchesFilter mismatch for ${item.key} (filter=${filter}) — dropped as a consistency guard`,
      );
    }
  }
  return kept;
}

// Items with no usable `at` (last_activity_at and created_at both null —
// only realistically possible for IG rows on a stale schema) are excluded
// from paging entirely rather than sorted-as-empty-string or used to build a
// cursor.
function hasAt(item: InboxItem): boolean {
  return item.at !== "";
}

async function fetchChannelItems(
  channel: Channel,
  filter: InboxFilter,
  fetchLimit: number,
  q: string,
  cursorAt: string | null,
  me: string,
  cursor: Cursor | null,
  igIssues: string[],
): Promise<InboxItem[]> {
  let items: InboxItem[];
  if (channel === "wa") {
    const rows = await fetchWaRows(filter, fetchLimit, q, cursorAt, me);
    items = rows.map(waToItem);
  } else if (channel === "ig") {
    const rows = await fetchIgRows(filter, fetchLimit, q, cursorAt, me, igIssues);
    items = rows.map(igToItem);
  } else {
    const rows = await fetchEmRows(filter, fetchLimit, q, cursorAt);
    items = rows.map(emailToItem);
  }
  items = items.filter(hasAt);
  items = assertMatchesFilter(items, filter, me);
  items = items.filter((i) => isAfterCursor(i.at, i.key, cursor));
  return items;
}

async function countChannelFilter(
  channel: Channel,
  filter: InboxFilter,
  q: string,
  me: string,
  igIssues: string[],
): Promise<number> {
  if (channel === "wa") return countWaFilter(filter, q, me);
  if (channel === "ig") return countIgFilter(filter, q, me, igIssues);
  return countEmFilter(filter, q);
}

export async function GET(req: NextRequest) {
  const user = await getCaller();
  if (!user?.email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = user.email;

  const { searchParams } = new URL(req.url);
  const filter = parseFilter(searchParams.get("filter"));
  const channels = parseChannels(searchParams.get("channel"));
  const channelKey = channels.length === ALL_CHANNELS.length ? "all" : channels[0];
  const q = searchParams.get("q") || "";
  const cursor = parseCursor(searchParams.get("cursor"));
  const rawLimit = parseInt(searchParams.get("limit") || "20", 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));

  const igIssues: string[] = [];

  // ---- list pass ----
  // Each channel fetches `limit + 10` rows already matching the requested
  // filter (pushed into SQL above) and bounded by `.lte(atColumn,
  // cursor.at)`, then isAfterCursor trims it to strictly-after-cursor. That
  // per-channel array (NOT yet capped to `limit`) is handed to
  // pageFromChannels, which does the final cross-channel merge + slice and
  // decides nextCursor — see src/lib/inbox/cursor.ts for the correctness
  // argument (nothing a channel doesn't return this round is ever lost: the
  // next page re-queries from the new cursor).
  const fetchLimit = limit + 10;
  const cursorAt = cursor?.at ?? null;

  const [channelRows, countsResult] = await Promise.all([
    Promise.all(
      channels.map((channel) => fetchChannelItems(channel, filter, fetchLimit, q, cursorAt, me, cursor, igIssues)),
    ),
    (async () => {
      // ---- counts pass (30s cache, pruned on every write) ----
      // Independent of the cursor — describes the whole matching set, not
      // just this page. Exact `count: "exact", head: true` queries, one per
      // (channel, filter) pair in scope, all in flight together.
      const cacheKey = `${me}|${channelKey}|${q}`;
      const cached = countsCache.get(cacheKey);
      const now = Date.now();
      if (cached && now - cached.ts < COUNTS_TTL_MS) return cached.counts;

      const pairs = channels.flatMap((channel) => FILTERS.map((f) => ({ channel, filter: f })));
      const values = await Promise.all(
        pairs.map(({ channel, filter: f }) => countChannelFilter(channel, f, q, me, igIssues)),
      );
      const counts = { human: 0, mine: 0, bot: 0, all: 0 } as Record<InboxFilter, number>;
      pairs.forEach(({ filter: f }, i) => {
        counts[f] += values[i];
      });

      pruneCountsCache(now);
      countsCache.set(cacheKey, { ts: now, counts });
      return counts;
    })(),
  ]);

  const { items, nextCursor } = pageFromChannels(channelRows, cursor, limit);
  const counts = countsResult;

  if (igIssues.length) {
    const unique = Array.from(new Set(igIssues));
    console.warn(
      `[inbox/conversations] ig_threads query failed (missing table or unavailable env) — Instagram treated as empty: ${unique.join("; ")}`,
    );
  }

  return NextResponse.json({
    items,
    counts,
    total: counts[filter],
    nextCursor,
    me,
  });
}
