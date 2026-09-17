import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
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
import { waSearchOr, igSearchOr, emSearchOr, quotePostgrestValue } from "@/lib/inbox/search";
import { waFilterPlan, igFilterPlan, emFilterPlan, type FilterPlan } from "@/lib/inbox/filters";
import {
  parseCursor,
  channelCursorBound,
  pageFromChannels,
  type Cursor,
  type CursorBound,
  type ChannelPage,
} from "@/lib/inbox/cursor";

// GET /api/inbox/conversations — unified read-only list across WhatsApp,
// Instagram and support-email threads for the Inbox hub (Task 2.3). Never
// writes; see the peek-read (`?peek=1`) addition on the per-thread GET
// routes for how opening a thread from here avoids clearing unread_count.
//
// Fix round 1 (review): filters are now pushed into SQL per channel instead
// of over-fetched-then-filtered-in-memory, and counts are exact `count:
// "exact", head: true` queries per channel per filter, not a 500-row sample.
//
// Fix round 2 (review):
//   - `filter=mine` was silently broken — sanitizeSearch (built for
//     free-text search, where lossy stripping is fine) was stripping "."
//     from the caller's own email before it went into an `.ilike()` clause.
//     Now uses ilikeExact (src/lib/inbox/search.ts), which escapes ILIKE's
//     own metacharacters instead of stripping arbitrary ones.
//   - "mine" now matches the pure rule's *effective* assignee
//     (assigned_to ?? ticket_assignee for WA) instead of "either field
//     matches", which could wrongly match a thread reassigned away from you
//     whose stale ticket_assignee still says you.
//   - Filter clause builders moved to src/lib/inbox/filters.ts as pure,
//     independently-tested functions (table-tested against matchesFilter).
//   - Paging is now tie-safe by construction: each channel query is ordered
//     (time column desc, id asc) and bounded by an exact tuple/lt/lte cursor
//     bound (channelCursorBound in cursor.ts) instead of a `.lte` + in-memory
//     trim — so a channel returns precisely the rows after the cursor, and
//     fetches exactly `limit` rows (no more over-fetch window).
export const dynamic = "force-dynamic";

type Channel = "wa" | "ig" | "em";
const ALL_CHANNELS: Channel[] = ["wa", "ig", "em"];
const FILTERS: InboxFilter[] = ["human", "mine", "bot", "all"];
const EMAIL_STATUSES = ["pending", "sent", "skipped", "failed"];

const WA_COLUMNS =
  "id, status, assigned_to, ticket_status, ticket_number, ticket_assignee, unread_count, last_message_snippet, last_activity_at, created_at, archived_at, contact:wa_contacts!inner(name, phone, wa_id)";
// MINOR (review): includes created_at so igToItem's last_activity_at →
// created_at fallback is actually populated, not silently always "".
const IG_COLUMNS =
  "id, status, classification, handle, full_name, ticket_status, assigned_to, unread_count, last_message_snippet, last_activity_at, created_at, archived_at";
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
// way (instead of `any`) so applyFilterPlan/applyCursorBound work
// identically against the list query (which also has .order/.limit) and the
// `count: "exact", head: true` query (which doesn't need those).
type QueryBuilder<Q> = {
  eq(column: string, value: string): Q;
  or(filters: string): Q;
  lt(column: string, value: string): Q;
  lte(column: string, value: string): Q;
};

// Turns a pure FilterPlan (src/lib/inbox/filters.ts) into the actual
// `.eq()/.or()` calls. Returns null when the plan is "skip" (email's bot/mine
// — can never match, so the caller should not run the query at all).
function applyFilterPlan<Q extends QueryBuilder<Q>>(query: Q, plan: FilterPlan): Q | null {
  switch (plan.type) {
    case "none":
      return query;
    case "skip":
      return null;
    case "or":
      return query.or(plan.clause);
    case "eqOr":
      return query.eq(plan.column, plan.value).or(plan.clause);
    default:
      return query;
  }
}

// Turns a CursorBound (src/lib/inbox/cursor.ts) into the actual query
// constraint. The `tuple` case needs a manual `.or()` string because it's a
// genuine OR of two conditions (`col.lt.X` OR `(col.eq.X AND id.gt.Y)`) — the
// timestamp and id values are quoted (quotePostgrestValue) since ISO
// timestamps contain `:`/`+`, which would otherwise be parsed as PostgREST
// syntax inside the `.or()` string.
function applyCursorBound<Q extends QueryBuilder<Q>>(query: Q, column: string, bound: CursorBound): Q {
  switch (bound.op) {
    case "none":
      return query;
    case "lt":
      return query.lt(column, bound.value);
    case "lte":
      return query.lte(column, bound.value);
    case "tuple": {
      const at = quotePostgrestValue(bound.value);
      const id = quotePostgrestValue(bound.id);
      return query.or(`${column}.lt.${at},and(${column}.eq.${at},id.gt.${id})`);
    }
    default:
      return query;
  }
}

async function fetchWaRows(
  filter: InboxFilter,
  limit: number,
  q: string,
  cursor: Cursor | null,
  me: string,
): Promise<{ rows: WaThreadRow[]; truncated: boolean }> {
  // Ordered (time column desc, id asc) so a channel's own rows arrive in
  // exactly the order compareItems would sort them (prefix is constant
  // within a channel, so "id asc" == "key asc"), and bounded by the exact
  // cursor tuple/lt/lte instead of a lossy `.lte` + in-memory trim.
  const build = (orderCol: string) => {
    let query = supabaseAdmin
      .from("wa_threads")
      .select(WA_COLUMNS)
      .is("archived_at", null)
      .order(orderCol, { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(limit);
    query = applyCursorBound(query, orderCol, channelCursorBound("wa", cursor));
    const filtered = applyFilterPlan(query, waFilterPlan(filter, me));
    if (!filtered) return null; // WA's plan never actually skips; kept honest for the shared type
    query = filtered;
    const orClause = waSearchOr(q);
    if (orClause) query = query.or(orClause);
    return query;
  };

  let built = build("last_activity_at");
  if (!built) return { rows: [], truncated: false };
  let { data, error } = await built;
  if (error?.code === "42703") {
    // Mirrors src/app/api/whatsapp/threads/route.ts's fallback: the
    // generated last_activity_at column hasn't landed on this DB yet.
    built = build("created_at");
    if (!built) return { rows: [], truncated: false };
    ({ data, error } = await built);
  }
  if (error) throw new Error(`wa_threads: ${error.message}`);
  const rows = (data ?? []) as unknown as WaThreadRow[];
  return { rows, truncated: rows.length === limit };
}

async function countWaFilter(filter: InboxFilter, q: string, me: string): Promise<number> {
  // ⚠️ Same inner join as the list query (contact:wa_contacts!inner) so a
  // wa_threads row with no matching wa_contacts row — which the list query
  // already excludes — doesn't inflate the count above what's reachable.
  let query = supabaseAdmin
    .from("wa_threads")
    .select("id, contact:wa_contacts!inner(id)", { count: "exact", head: true })
    .is("archived_at", null);
  const filtered = applyFilterPlan(query, waFilterPlan(filter, me));
  if (!filtered) return 0;
  query = filtered;
  const orClause = waSearchOr(q);
  if (orClause) query = query.or(orClause);
  const { count, error } = await query;
  if (error) throw new Error(`wa_threads count: ${error.message}`);
  return count ?? 0;
}

// IG failures (missing table, RLS, empty env) degrade to an empty list
// instead of a 500 for the whole route — Instagram is one channel of three.
// Failures are collected on `igIssues` and logged once, at the end of the
// request, by the caller — including the real error message (review MINOR).
async function fetchIgRows(
  filter: InboxFilter,
  limit: number,
  q: string,
  cursor: Cursor | null,
  me: string,
  igIssues: string[],
): Promise<{ rows: IgThreadRow[]; truncated: boolean }> {
  try {
    let query = supabaseAdmin
      .from("ig_threads")
      .select(IG_COLUMNS)
      .is("archived_at", null)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(limit);
    query = applyCursorBound(query, "last_activity_at", channelCursorBound("ig", cursor));
    const filtered = applyFilterPlan(query, igFilterPlan(filter, me));
    if (!filtered) return { rows: [], truncated: false };
    query = filtered;
    const orClause = igSearchOr(q);
    if (orClause) query = query.or(orClause);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown as IgThreadRow[];
    return { rows, truncated: rows.length === limit };
  } catch (err) {
    igIssues.push(err instanceof Error ? err.message : String(err));
    return { rows: [], truncated: false };
  }
}

async function countIgFilter(filter: InboxFilter, q: string, me: string, igIssues: string[]): Promise<number> {
  try {
    let query = supabaseAdmin
      .from("ig_threads")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null);
    const filtered = applyFilterPlan(query, igFilterPlan(filter, me));
    if (!filtered) return 0;
    query = filtered;
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
  cursor: Cursor | null,
): Promise<{ rows: EmailThreadRow[]; truncated: boolean }> {
  let query = supabaseAdmin
    .from("email_threads")
    .select(EM_COLUMNS)
    .in("status", EMAIL_STATUSES)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  query = applyCursorBound(query, "created_at", channelCursorBound("em", cursor));

  const filtered = applyFilterPlan(query, emFilterPlan(filter));
  if (!filtered) return { rows: [], truncated: false }; // bot/mine can never match email — skip the query
  query = filtered;

  const orClause = emSearchOr(q);
  if (orClause) query = query.or(orClause);

  const { data, error } = await query;
  if (error) throw new Error(`email_threads: ${error.message}`);
  const rows = (data ?? []) as unknown as EmailThreadRow[];
  return { rows, truncated: rows.length === limit };
}

async function countEmFilter(filter: InboxFilter, q: string): Promise<number> {
  let query = supabaseAdmin
    .from("email_threads")
    .select("id", { count: "exact", head: true })
    .in("status", EMAIL_STATUSES);

  const filtered = applyFilterPlan(query, emFilterPlan(filter));
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
// invisible until someone noticed missing/extra rows in the UI. This must
// NOT affect a channel's `truncated` flag (see fetchChannelPage) — that
// reflects the raw fetch size, independent of any drops here.
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
// cursor. Review MINOR: the counts pass (exact head:true queries) can't
// cheaply apply this same exclusion without mapping every row to an
// InboxItem first, which would defeat the point of an exact count query —
// accepted as a known gap (at-less rows, if any exist, are excluded from the
// list but still counted) rather than adding that complexity.
function hasAt(item: InboxItem): boolean {
  return item.at !== "";
}

async function fetchChannelPage(
  channel: Channel,
  filter: InboxFilter,
  limit: number,
  q: string,
  cursor: Cursor | null,
  me: string,
  igIssues: string[],
): Promise<ChannelPage> {
  let items: InboxItem[];
  let truncated: boolean;
  if (channel === "wa") {
    const { rows, truncated: t } = await fetchWaRows(filter, limit, q, cursor, me);
    items = rows.map(waToItem);
    truncated = t;
  } else if (channel === "ig") {
    const { rows, truncated: t } = await fetchIgRows(filter, limit, q, cursor, me, igIssues);
    items = rows.map(igToItem);
    truncated = t;
  } else {
    const { rows, truncated: t } = await fetchEmRows(filter, limit, q, cursor);
    items = rows.map(emailToItem);
    truncated = t;
  }
  items = items.filter(hasAt);
  items = assertMatchesFilter(items, filter, me);
  return { items, truncated }; // truncated is the RAW fetch size check — unaffected by the drops above
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

  const [channelPages, countsResult] = await Promise.all([
    // ---- list pass ----
    // Each channel fetches exactly `limit` rows already matching the
    // requested filter (pushed into SQL) and bounded by the exact cursor
    // tuple/lt/lte (channelCursorBound) — see src/lib/inbox/cursor.ts for
    // the tie-safety/correctness argument. pageFromChannels does the final
    // cross-channel merge + nextCursor decision.
    Promise.all(channels.map((channel) => fetchChannelPage(channel, filter, limit, q, cursor, me, igIssues))),
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

  const { items, nextCursor } = pageFromChannels(channelPages, cursor, limit);
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
