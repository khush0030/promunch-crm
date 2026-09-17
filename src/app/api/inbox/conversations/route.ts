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
  mergeItems,
  nextCursor,
  countFilters,
} from "@/lib/inbox/conversations";
import { parseCursor, isAfterCursor, type Cursor } from "@/lib/inbox/cursor";

// GET /api/inbox/conversations — unified read-only list across WhatsApp,
// Instagram and support-email threads for the Inbox hub (Task 2.3). Never
// writes; see the peek-read (`?peek=1`) addition on the per-thread GET
// routes for how opening a thread from here avoids clearing unread_count.
export const dynamic = "force-dynamic";

type Channel = "wa" | "ig" | "em";
const ALL_CHANNELS: Channel[] = ["wa", "ig", "em"];
const FILTERS: InboxFilter[] = ["human", "mine", "bot", "all"];
const EMAIL_STATUSES = ["pending", "sent", "skipped", "failed"];

// Full columns for the paginated list pass.
const WA_LIST_COLUMNS =
  "id, status, assigned_to, ticket_status, ticket_number, ticket_assignee, unread_count, last_message_snippet, last_activity_at, created_at, archived_at, contact:wa_contacts!inner(name, phone, wa_id)";
const IG_LIST_COLUMNS =
  "id, status, classification, handle, full_name, ticket_status, assigned_to, unread_count, last_message_snippet, last_activity_at, archived_at";
const EM_LIST_COLUMNS =
  "id, status, should_reply, from_name, from_email, subject, lead_category, urgency, created_at";

// Lighter columns for the counts pass — same fields matchesFilter/toItem
// need to compute pill/needsHuman/assignee/bot, minus the preview text.
const WA_COUNT_COLUMNS =
  "id, status, assigned_to, ticket_status, ticket_number, ticket_assignee, unread_count, last_activity_at, created_at, archived_at, contact:wa_contacts!inner(name, phone, wa_id)";
const IG_COUNT_COLUMNS =
  "id, status, classification, handle, full_name, ticket_status, assigned_to, unread_count, last_activity_at, archived_at";
const EM_COUNT_COLUMNS = "id, status, should_reply, from_name, from_email, created_at";

// counts cache: 30s TTL, keyed by requester + channel scope + search text so
// different tabs/searches never share stale numbers with each other.
const countsCache = new Map<string, { ts: number; counts: Record<InboxFilter, number> }>();
const COUNTS_TTL_MS = 30_000;

function parseFilter(raw: string | null): InboxFilter {
  return (FILTERS as string[]).includes(raw ?? "") ? (raw as InboxFilter) : "human";
}

function parseChannels(raw: string | null): Channel[] {
  if (raw === "wa" || raw === "ig" || raw === "em") return [raw];
  return ALL_CHANNELS; // "all", missing, or an invalid value
}

// WA search mirrors src/app/api/whatsapp/threads/route.ts exactly: wa_id /
// last_message_snippet / ticket_subject / escalation_reason ilike, plus an
// exact ticket_number match when the (# stripped) query is all digits.
async function fetchWaRows(
  cols: string,
  limit: number,
  q: string,
  cursorAt: string | null,
): Promise<WaThreadRow[]> {
  const build = (orderCol: string) => {
    let query = supabaseAdmin
      .from("wa_threads")
      .select(cols)
      .is("archived_at", null)
      .order(orderCol, { ascending: false, nullsFirst: false })
      .limit(limit);
    if (cursorAt) query = query.lte(orderCol, cursorAt);
    if (q) {
      const safe = sanitizeSearch(q);
      if (safe) {
        const clauses = [
          `wa_id.ilike.%${safe}%`,
          `last_message_snippet.ilike.%${safe}%`,
          `ticket_subject.ilike.%${safe}%`,
          `escalation_reason.ilike.%${safe}%`,
        ];
        const digits = safe.replace(/^#/, "");
        if (/^\d+$/.test(digits)) clauses.push(`ticket_number.eq.${digits}`);
        query = query.or(clauses.join(","));
      }
    }
    return query;
  };

  let { data, error } = await build("last_activity_at");
  if (error?.code === "42703") {
    // Mirrors the existing threads route's fallback: the generated
    // last_activity_at column hasn't landed on this DB yet.
    ({ data, error } = await build("created_at"));
  }
  if (error) throw new Error(`wa_threads: ${error.message}`);
  return (data ?? []) as unknown as WaThreadRow[];
}

// IG failures (missing table, RLS, empty env) degrade to an empty list
// instead of a 500 for the whole route — Instagram is one channel of three.
async function fetchIgRows(
  cols: string,
  limit: number,
  q: string,
  cursorAt: string | null,
): Promise<{ rows: IgThreadRow[]; failed: boolean }> {
  try {
    let query = supabaseAdmin
      .from("ig_threads")
      .select(cols)
      .is("archived_at", null)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (cursorAt) query = query.lte("last_activity_at", cursorAt);
    if (q) {
      const safe = sanitizeSearch(q);
      if (safe) {
        query = query.or(
          `handle.ilike.%${safe}%,full_name.ilike.%${safe}%,last_message_snippet.ilike.%${safe}%`,
        );
      }
    }
    const { data, error } = await query;
    if (error) throw error;
    return { rows: (data ?? []) as unknown as IgThreadRow[], failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

async function fetchEmRows(
  cols: string,
  limit: number,
  q: string,
  cursorAt: string | null,
): Promise<EmailThreadRow[]> {
  let query = supabaseAdmin
    .from("email_threads")
    .select(cols)
    .in("status", EMAIL_STATUSES)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (cursorAt) query = query.lte("created_at", cursorAt);
  if (q) {
    const safe = sanitizeSearch(q);
    if (safe) query = query.or(`from_email.ilike.%${safe}%,from_name.ilike.%${safe}%,subject.ilike.%${safe}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`email_threads: ${error.message}`);
  return (data ?? []) as unknown as EmailThreadRow[];
}

function filterAndBound(items: InboxItem[], filter: InboxFilter, me: string, cursor: Cursor | null) {
  return items.filter((i) => matchesFilter(i, filter, me)).filter((i) => isAfterCursor(i.at, i.key, cursor));
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

  let igFailed = false;

  // ---- list pass ----
  // Filtering (matchesFilter + the cursor boundary) happens in memory AFTER
  // the fetch, not in the query, because matchesFilter depends on computed
  // InboxItem fields (needsHuman/assignee/bot). So each channel over-fetches
  // up to 3x the page size (capped at 150) bounded by `lte` on the cursor's
  // `at`, then isAfterCursor drops anything not strictly after the cursor —
  // this keeps a page from coming back short just because many rows in the
  // fetched window got filtered out, without duplicating or losing rows tied
  // on `at` across a page boundary.
  const fetchLimit = Math.min(150, limit * 3);
  const cursorAt = cursor?.at ?? null;

  const lists: InboxItem[][] = [];

  if (channels.includes("wa")) {
    const rows = await fetchWaRows(WA_LIST_COLUMNS, fetchLimit, q, cursorAt);
    lists.push(filterAndBound(rows.map(waToItem), filter, me, cursor));
  }
  if (channels.includes("ig")) {
    const { rows, failed } = await fetchIgRows(IG_LIST_COLUMNS, fetchLimit, q, cursorAt);
    if (failed) igFailed = true;
    lists.push(filterAndBound(rows.map(igToItem), filter, me, cursor));
  }
  if (channels.includes("em")) {
    const rows = await fetchEmRows(EM_LIST_COLUMNS, fetchLimit, q, cursorAt);
    lists.push(filterAndBound(rows.map(emailToItem), filter, me, cursor));
  }

  const items = mergeItems(lists, limit);
  const cursorOut = nextCursor(items, limit);

  // ---- counts pass (30s cache) ----
  // Counts reflect the channel scope + search, independent of the cursor —
  // they describe the whole matching set, not just this page.
  const cacheKey = `${me}|${channelKey}|${q}`;
  const cached = countsCache.get(cacheKey);
  let counts: Record<InboxFilter, number>;
  if (cached && Date.now() - cached.ts < COUNTS_TTL_MS) {
    counts = cached.counts;
  } else {
    const countLists: InboxItem[][] = [];
    if (channels.includes("wa")) {
      const rows = await fetchWaRows(WA_COUNT_COLUMNS, 500, q, null);
      countLists.push(rows.map(waToItem));
    }
    if (channels.includes("ig")) {
      const { rows, failed } = await fetchIgRows(IG_COUNT_COLUMNS, 500, q, null);
      if (failed) igFailed = true;
      countLists.push(rows.map(igToItem));
    }
    if (channels.includes("em")) {
      const rows = await fetchEmRows(EM_COUNT_COLUMNS, 500, q, null);
      countLists.push(rows.map(emailToItem));
    }
    counts = countFilters(countLists.flat(), me);
    countsCache.set(cacheKey, { ts: Date.now(), counts });
  }

  if (igFailed) {
    console.warn(
      "[inbox/conversations] ig_threads query failed (missing table or unavailable env) — Instagram treated as empty for this request",
    );
  }

  return NextResponse.json({
    items,
    counts,
    total: counts[filter],
    nextCursor: cursorOut,
    me,
  });
}
