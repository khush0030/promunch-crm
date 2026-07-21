import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { getSecret, bustSecretCache } from "@/lib/secrets";
import { GROWTH_DEFAULTS, normalizeGrowthConfig, type GrowthConfig } from "@/lib/wa-embed";

export const dynamic = "force-dynamic";

// Backend for the Growth tab: opt-in popup stats, the website chat-widget
// tracked link, named QR codes, embed configuration, and one-click install of
// the embed on the Shopify storefront (script tag — no theme edit).
//
// Tracked entry points are wa_short_links rows (sent_by = 'growth:widget' |
// 'growth:qr:<name>') so /r/<code> logs every click/scan into wa_link_clicks.
// Config + install state live in app_secrets (WA_GROWTH_CONFIG /
// WA_GROWTH_SCRIPT_TAG_ID) — key-value, no migration, readable by the public
// embed route through getSecret().

const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER || "919981310247";
const APP_URL = (process.env.SITE_APP_URL || "https://promunch-crm.vercel.app").replace(/\/+$/, "");
const EMBED_URL = `${APP_URL}/api/public/wa-embed`;

const waLink = (prefill: string) =>
  `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(prefill)}`;

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function newCode(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

/* ---------------- app_secrets-backed settings ---------------- */

async function saveSetting(name: string, value: string | null): Promise<string | null> {
  if (value === null) {
    const { error } = await supabaseAdmin.from("app_secrets").delete().eq("name", name);
    bustSecretCache(name);
    return error?.message ?? null;
  }
  const { error } = await supabaseAdmin
    .from("app_secrets")
    .upsert({ name, value, updated_at: new Date().toISOString() }, { onConflict: "name" });
  bustSecretCache(name);
  return error?.message ?? null;
}

async function loadConfig(): Promise<GrowthConfig> {
  try {
    const raw = await getSecret("WA_GROWTH_CONFIG");
    if (raw) return normalizeGrowthConfig(JSON.parse(raw));
  } catch { /* fall through */ }
  return GROWTH_DEFAULTS;
}

/* ---------------- Shopify script-tag install ---------------- */

const SHOP_DOMAIN = process.env.SHOPIFY_STORE_URL || "a1e4f4-2.myshopify.com";

async function shopifyScriptTags(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
  const token = await getSecret("SHOPIFY_ACCESS_TOKEN");
  if (!token || token === "placeholder_needs_real_token") {
    return { ok: false as const, status: 0, error: "Shopify Admin token not configured (Settings → API keys → SHOPIFY_ACCESS_TOKEN)." };
  }
  const r = await fetch(`https://${SHOP_DOMAIN}/admin/api/2024-01${path}`, {
    method,
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const hint = r.status === 403 || r.status === 401
      ? " The app token likely lacks the write_script_tags scope: Shopify admin → Settings → Apps → Develop apps → your app → API scopes → enable read/write script tags, reinstall, then update the token in Settings → API keys."
      : "";
    return { ok: false as const, status: r.status, error: `Shopify ${r.status}: ${JSON.stringify(json?.errors ?? json).slice(0, 300)}${hint}` };
  }
  return { ok: true as const, status: r.status, json };
}

/* ---------------- shared reads ---------------- */

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

  const { count: popupLeads } = await supabaseAdmin
    .from("wa_contacts")
    .select("*", { count: "exact", head: true })
    .eq("consent_source", "website_popup");

  const [config, scriptTagId] = await Promise.all([loadConfig(), getSecret("WA_GROWTH_SCRIPT_TAG_ID")]);

  return NextResponse.json({
    wa_number: WA_NUMBER,
    config,
    installed: !!scriptTagId,
    script_tag_id: scriptTagId,
    shop_domain: SHOP_DOMAIN,
    embed_url: EMBED_URL,
    loader_snippet: `<script src="${EMBED_URL}" defer></script>`,
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

type PostBody = {
  kind?: "qr" | "config" | "install" | "uninstall";
  // qr
  name?: string;
  prefill?: string;
  // config
  config?: GrowthConfig;
};

export async function POST(req: NextRequest) {
  const body = await parseBody<PostBody>(req);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  const kind = body.kind ?? "qr";

  if (kind === "config") {
    const cfg = normalizeGrowthConfig(body.config);
    const err = await saveSetting("WA_GROWTH_CONFIG", JSON.stringify(cfg));
    if (err) return NextResponse.json({ error: err }, { status: 500 });
    return NextResponse.json({ ok: true, config: cfg });
  }

  if (kind === "install") {
    // Idempotent: reuse an existing tag pointing at our embed before creating.
    const existing = await shopifyScriptTags("GET", "/script_tags.json?src=" + encodeURIComponent(EMBED_URL));
    if (!existing.ok) return NextResponse.json({ error: existing.error }, { status: 502 });
    const found = (existing.json?.script_tags ?? [])[0];
    let id = found?.id ? String(found.id) : null;
    if (!id) {
      const created = await shopifyScriptTags("POST", "/script_tags.json", {
        script_tag: { event: "onload", src: EMBED_URL },
      });
      if (!created.ok) return NextResponse.json({ error: created.error }, { status: 502 });
      id = String(created.json?.script_tag?.id ?? "");
    }
    if (!id) return NextResponse.json({ error: "Shopify accepted the request but returned no script tag id." }, { status: 502 });
    const err = await saveSetting("WA_GROWTH_SCRIPT_TAG_ID", id);
    if (err) return NextResponse.json({ error: err }, { status: 500 });
    return NextResponse.json({ ok: true, script_tag_id: id });
  }

  if (kind === "uninstall") {
    const id = await getSecret("WA_GROWTH_SCRIPT_TAG_ID");
    if (id) {
      const del = await shopifyScriptTags("DELETE", `/script_tags/${id}.json`);
      // 404 = already gone at Shopify; still clear our record.
      if (!del.ok && del.status !== 404) return NextResponse.json({ error: del.error }, { status: 502 });
    }
    const err = await saveSetting("WA_GROWTH_SCRIPT_TAG_ID", null);
    if (err) return NextResponse.json({ error: err }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // kind === "qr"
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
