import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parseBody } from "@/lib/api-helpers";
import { bad } from "@/lib/email-studio/route-helpers";

// Signed direct-to-storage upload for builder images (email-assets bucket,
// public, created by migration 016). The browser PUTs the bytes to the
// signed URL, so large images never pass through a Vercel function body.
export const dynamic = "force-dynamic";

const TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX = 5 * 1024 * 1024;

function slugify(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${base || "image"}${ext ? `.${ext}` : ""}`;
}

export async function POST(req: NextRequest) {
  const body = await parseBody<{ name?: string; mime?: string; size?: number }>(req);
  if (!body) return bad("invalid JSON body");
  if (!TYPES.includes(String(body.mime))) return bad("Use a JPG, PNG, GIF or WebP image.");
  if (!(Number(body.size) > 0) || Number(body.size) > MAX) return bad("Images must be under 5 MB. Compress it and try again.");

  const month = new Date().toISOString().slice(0, 7);
  const path = `${month}/${crypto.randomUUID()}-${slugify(String(body.name ?? "image"))}`;
  const { data, error } = await supabaseAdmin.storage.from("email-assets").createSignedUploadUrl(path);
  if (error || !data) {
    const hint = /not found/i.test(error?.message ?? "") ? " (the email-assets bucket is created by migration 016)" : "";
    return bad(`Could not prepare the upload: ${error?.message ?? "unknown error"}${hint}`, 500);
  }
  const { data: pub } = supabaseAdmin.storage.from("email-assets").getPublicUrl(path);
  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path: data.path, publicUrl: pub.publicUrl });
}
