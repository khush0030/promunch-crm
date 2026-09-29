import { NextRequest, NextResponse } from "next/server";
import { parseBody } from "@/lib/api-helpers";
import { parseRules, describeRules } from "@/lib/email-studio/segments";
import { countAudience } from "@/lib/email-studio/audience-server";

// Live "this audience = N people" count while the employee builds a segment.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await parseBody<{ rules?: unknown }>(req);
  const rules = parseRules(body?.rules);
  try {
    const { count, sample } = await countAudience(rules);
    return NextResponse.json({ count, sample, summary: describeRules(rules) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "count failed" }, { status: 500 });
  }
}
