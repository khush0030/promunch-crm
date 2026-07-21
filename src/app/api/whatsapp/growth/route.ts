import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// Backend for the Growth tab: opt-in popup stats, the website chat-widget
// tracked link, and named QR codes. All tracked entry points are wa_short_links
// rows (sent_by = 'growth:widget' | 'growth:qr:<name>') so /r/<code> logs
// every click/scan into wa_link_clicks — same pipeline campaigns use.

const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER || "919981310247";

const waLink = (prefill: string) =>
  `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(prefill)}`;

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function newCode(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

type LinkRow = { code: string; target_url: string; sent_by: string | null; created_at: string };

async function growthLinks(): Promise<LinkRow[]> {
  const { data } = await supabaseAdmin
    .from("wa_short_links")
    .select("code,target_url,sent_by,created_at")
    .like("sent_by", "growth:%")
    .order("created_at", { ascending: false })
    .limit(500);
  return (data ?? []) as LinkRow[];
}

async function clickCounts(codes: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!codes.length) return counts;
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin
      .from("wa_link_clicks")
      .select("code")
      .in("code", codes)
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data as { code: string }[]) counts.set(r.code, (counts.get(r.code) ?? 0) + 1);
    if (data.length < 1000) break;
  }
  return counts;
}

export async function GET() {
  const links = await growthLinks();

  // The widget uses ONE stable tracked link; mint it on first load.
  let widget = links.find((l) => l.sent_by === "growth:widget") ?? null;
  if (!widget) {
    const code = newCode();
    const target = waLink("Hi PROMUNCH! I have a question 🌱");
    const { error } = await supabaseAdmin
      .from("wa_short_links")
      .insert({ code, target_url: target, sent_by: "growth:widget" });
    if (!error) widget = { code, target_url: target, sent_by: "growth:widget", created_at: new Date().toISOString() };
  }

  const qrs = links.filter((l) => (l.sent_by ?? "").startsWith("growth:qr:"));
  const counts = await clickCounts([...(widget ? [widget.code] : []), ...qrs.map((q) => q.code)]);

  // Popup performance: contacts whose consent came from the popup / widget.
  const { count: popupLeads } = await supabaseAdmin
    .from("wa_contacts")
    .select("*", { count: "exact", head: true })
    .eq("consent_source", "website_popup");

  return NextResponse.json({
    wa_number: WA_NUMBER,
    popup: { leads: popupLeads ?? 0 },
    widget: widget ? { code: widget.code, target: widget.target_url, clicks: counts.get(widget.code) ?? 0 } : null,
    qrs: qrs.map((q) => ({
      code: q.code,
      name: (q.sent_by ?? "").replace(/^growth:qr:/, ""),
      target: q.target_url,
      scans: counts.get(q.code) ?? 0,
      created_at: q.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await parseBody<{ name?: string; prefill?: string }>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  const name = String(body.name ?? "").trim().toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/\s+/g, "-").slice(0, 40);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const links = await growthLinks();
  if (links.some((l) => l.sent_by === `growth:qr:${name}`)) {
    return NextResponse.json({ error: `QR "${name}" already exists` }, { status: 409 });
  }

  // Prefill doubles as the attribution marker: each QR gets distinct opening
  // text, so when the scan turns into an inbound message we can see where the
  // customer came from in the thread.
  const prefill = String(body.prefill ?? "").trim().slice(0, 200) || `Hi PROMUNCH! Saw your QR (${name}) 🌱`;
  const code = newCode();
  const { error } = await supabaseAdmin
    .from("wa_short_links")
    .insert({ code, target_url: waLink(prefill), sent_by: `growth:qr:${name}` });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ qr: { code, name, target: waLink(prefill), scans: 0, created_at: new Date().toISOString() } });
}
