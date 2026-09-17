import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/rbac-server";
import { brevo, BrevoError } from "@/lib/brevo";

// Adds a public image URL to the Brevo image gallery (for campaign content).
// POST {imageUrl, name?} (admin) -> {url}
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const b = ((await req.json().catch(() => null)) ?? {}) as { imageUrl?: string; name?: string };
  let url: URL;
  try {
    url = new URL(String(b.imageUrl ?? ""));
    if (url.protocol !== "https:") throw new Error("https only");
  } catch {
    return NextResponse.json({ ok: false, error: "imageUrl must be a public https URL" }, { status: 400 });
  }
  try {
    const r = await brevo<{ url?: string }>("POST", "/emailCampaigns/images", { imageUrl: url.toString(), ...(b.name ? { name: b.name.slice(0, 100) } : {}) });
    return NextResponse.json({ ok: true, url: r.url ?? null });
  } catch (e) {
    const msg = e instanceof BrevoError ? `Brevo: ${e.message}` : e instanceof Error ? e.message : "upload failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
