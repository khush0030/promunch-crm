import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jsonError, requireUser } from "@/lib/orm/db";
import {
  combineOrGroups,
  HANDLED_STATUSES,
  nextBefore,
  OPEN_CASE_STATUSES,
  OPEN_STATUSES,
  orGroups,
  parseMentionFilters,
} from "@/lib/orm/filters";
import { MENTION_COLUMNS, type OrmMention } from "@/lib/orm/types";

export const dynamic = "force-dynamic";

// GET /api/orm/mentions?status=new|needs_reply|handled|cases|all|<status list>&source=&sentiment=&urgency=&q=&owned=&before=&limit=
// Newest first by posted_at; `before` is the posted_at cursor of the last row.
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const f = parseMentionFilters(req.nextUrl.searchParams);

  let q = supabaseAdmin
    .from("orm_mentions")
    .select(MENTION_COLUMNS)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(f.limit);

  if (!f.includeIrrelevant) q = q.not("relevant", "is", false);
  if (f.statuses) q = q.in("status", f.statuses);
  if (f.view === "needs_reply") q = q.in("status", OPEN_STATUSES);
  if (f.view === "handled") q = q.in("status", HANDLED_STATUSES);
  if (f.view === "cases") q = q.in("case_status", [...OPEN_CASE_STATUSES]);
  if (f.source) q = q.eq("source", f.source);
  if (f.sentiment === "neg") q = q.lt("sentiment", 0);
  if (f.sentiment === "neu") q = q.eq("sentiment", 0);
  if (f.sentiment === "pos") q = q.gt("sentiment", 0);
  if (f.urgency) q = q.in("urgency", f.urgency);
  if (f.owned !== null) q = q.eq("is_owned", f.owned);
  if (f.before) q = q.lt("posted_at", f.before);
  const or = combineOrGroups(orGroups(f));
  if (or) q = q.or(or);

  const { data, error } = await q;
  if (error) return jsonError(error.message, 500);
  const mentions = (data ?? []) as unknown as OrmMention[];
  return NextResponse.json({ mentions, next_before: nextBefore(mentions, f.limit) });
}
