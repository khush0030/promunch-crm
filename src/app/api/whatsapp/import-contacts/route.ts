import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Bulk-import CRM contacts (Shopify-synced) into wa_contacts so they can be
// targeted by WhatsApp marketing campaigns. Existing wa_contacts are never
// overwritten (ignoreDuplicates) — live conversations keep their state.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Normalise a raw phone string to a Meta wa_id (digits only, India default).
function toWaId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

export async function POST() {
  const PAGE = 1000;
  let scanned = 0;
  let skipped = 0;
  let lastError: string | null = null;
  const seen = new Set<string>();

  const { count: before } = await supabaseAdmin
    .from("wa_contacts")
    .select("id", { count: "exact", head: true });

  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("contacts")
        .select("first_name,last_name,phone,email,shopify_customer_id")
        .not("phone", "is", null)
        .range(from, from + PAGE - 1);
      if (error) { lastError = error.message; break; }
      if (!data || data.length === 0) break;

      const rows = [];
      for (const c of data) {
        scanned++;
        const waId = toWaId(c.phone);
        if (!waId || seen.has(waId)) { skipped++; continue; }
        seen.add(waId);
        rows.push({
          wa_id: waId,
          phone: "+" + waId,
          name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
          email: c.email ?? null,
          shopify_customer_id: c.shopify_customer_id ? String(c.shopify_customer_id) : null,
          tags: ["shopify_import"],
          opted_in: true,
        });
      }

      if (rows.length) {
        const { error: upErr } = await supabaseAdmin
          .from("wa_contacts")
          .upsert(rows, { onConflict: "wa_id", ignoreDuplicates: true });
        if (upErr) lastError = upErr.message;
      }
      if (data.length < PAGE) break;
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }

  const { count: after } = await supabaseAdmin
    .from("wa_contacts")
    .select("id", { count: "exact", head: true });
  const imported = Math.max(0, (after ?? 0) - (before ?? 0));

  return NextResponse.json({
    ok: !lastError,
    scanned,
    imported,
    skipped,
    total_wa_contacts: after ?? 0,
    error: lastError,
  });
}
