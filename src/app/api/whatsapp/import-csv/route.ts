import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { TIER_TAGS } from "@/lib/wa-engagement";

// Import a parsed CSV contact list into wa_contacts. The browser parses the
// CSV and posts { rows: [{ phone, name?, email? }] }. Existing contacts are
// never overwritten (ignoreDuplicates).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function toWaId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

interface InRow { phone?: string; name?: string; email?: string }

export async function POST(req: NextRequest) {
  let body: { rows?: InRow[]; tag?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const inRows = Array.isArray(body.rows) ? body.rows : [];
  if (inRows.length === 0) return NextResponse.json({ error: "no rows in CSV" }, { status: 400 });
  const tag = (body.tag || "csv_import").trim() || "csv_import";

  const { count: before } = await supabaseAdmin
    .from("wa_contacts")
    .select("id", { count: "exact", head: true });

  let scanned = 0;
  let skipped = 0;
  let lastError: string | null = null;
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];

  for (const r of inRows) {
    scanned++;
    const waId = toWaId(r.phone);
    if (!waId || seen.has(waId)) { skipped++; continue; }
    seen.add(waId);
    rows.push({
      wa_id: waId,
      phone: "+" + waId,
      name: (r.name || "").trim() || null,
      email: (r.email || "").trim() || null,
      // An uploaded phone list is not a marketing opt-in — tier it as imported
      // so the campaign builder never mistakes it for an engaged audience.
      tags: [tag, TIER_TAGS.imported],
      opted_in: true,
    });
  }

  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supabaseAdmin
      .from("wa_contacts")
      .upsert(rows.slice(i, i + 1000), { onConflict: "wa_id", ignoreDuplicates: true });
    if (error) lastError = error.message;
  }

  const { count: after } = await supabaseAdmin
    .from("wa_contacts")
    .select("id", { count: "exact", head: true });

  return NextResponse.json({
    ok: !lastError,
    scanned,
    skipped,
    imported: Math.max(0, (after ?? 0) - (before ?? 0)),
    total_wa_contacts: after ?? 0,
    error: lastError,
  });
}
