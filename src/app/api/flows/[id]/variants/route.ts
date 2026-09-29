// A/B report for one email flow: sends / opens / clicks per (step, variant).
// Read-only. Session-gated by middleware (/api/flows → email_marketing area).

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { summarizeVariants, type VariantSendRow } from "@/lib/email/send-guards";

const PAGE = 1000;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows: VariantSendRow[] = [];
  let hasVariantColumn = true;
  for (let from = 0; ; from += PAGE) {
    const cols = hasVariantColumn
      ? "step_index, variant, status, opened_at, clicked_at"
      : "step_index, status, opened_at, clicked_at";
    const { data, error } = await supabase
      .from("email_sends")
      .select(cols)
      .eq("flow_id", id)
      .eq("status", "sent")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      // Migration 20260930110000 not applied yet: report everything as "A".
      if (hasVariantColumn && /variant/i.test(error.message)) {
        hasVariantColumn = false;
        from -= PAGE;
        continue;
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const page = (data ?? []) as unknown as Array<Partial<VariantSendRow> & { step_index: number; status: string }>;
    for (const r of page) {
      rows.push({
        step_index: r.step_index,
        variant: r.variant ?? null,
        status: r.status,
        opened_at: r.opened_at ?? null,
        clicked_at: r.clicked_at ?? null,
      });
    }
    if (page.length < PAGE) break;
  }
  return NextResponse.json({ stats: summarizeVariants(rows) });
}
