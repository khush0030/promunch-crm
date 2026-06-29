import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Per-campaign recipient list: exactly who a WhatsApp campaign was sent to and
// what happened to each message. Grouped by contact so duplicates are visible
// (the Edamame incident: 86 contacts messaged more than once). Powers the
// campaign "Recipients" view.

type Row = { contact_id: string | null; status: string; error: string | null; created_at: string };
const RANK: Record<string, number> = { read: 4, delivered: 3, sent: 2, queued: 1, failed: 0 };

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // all message rows for this campaign (paginate past 1000)
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("wa_messages")
      .select("contact_id,status,error,created_at")
      .eq("campaign_id", id)
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // group by contact → best status + attempt count
  const byContact = new Map<string, { status: string; attempts: number; delivered: number; error: string | null; at: string }>();
  for (const r of rows) {
    if (!r.contact_id) continue;
    const g = byContact.get(r.contact_id) || { status: "failed", attempts: 0, delivered: 0, error: null, at: r.created_at };
    g.attempts += 1;
    if ((RANK[r.status] ?? 0) >= (RANK[g.status] ?? 0)) { g.status = r.status; g.at = r.created_at; }
    if (["sent", "delivered", "read"].includes(r.status)) g.delivered += 1;
    if (r.status === "failed" && !g.error) g.error = r.error;
    byContact.set(r.contact_id, g);
  }

  // hydrate contact names/numbers
  const ids = [...byContact.keys()];
  const nameById = new Map<string, { name: string | null; wa_id: string | null }>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabaseAdmin.from("wa_contacts").select("id,name,wa_id").in("id", ids.slice(i, i + 500));
    (data ?? []).forEach((c: { id: string; name: string | null; wa_id: string | null }) => nameById.set(c.id, { name: c.name, wa_id: c.wa_id }));
  }

  const recipients = [...byContact.entries()]
    .map(([cid, g]) => ({
      contact_id: cid,
      name: nameById.get(cid)?.name ?? null,
      wa_id: nameById.get(cid)?.wa_id ?? null,
      status: g.status,
      attempts: g.attempts,
      duplicate: g.delivered > 1,
      error: g.error,
      at: g.at,
    }))
    .sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || a.name?.localeCompare(b.name ?? "") || 0);

  const summary = {
    rows: rows.length,
    contacts: byContact.size,
    received: recipients.filter((r) => ["sent", "delivered", "read"].includes(r.status)).length,
    delivered: recipients.filter((r) => r.status === "delivered" || r.status === "read").length,
    read: recipients.filter((r) => r.status === "read").length,
    failed: recipients.filter((r) => r.status === "failed").length,
    duplicates: recipients.filter((r) => r.duplicate).length,
  };

  return NextResponse.json({ summary, recipients });
}
