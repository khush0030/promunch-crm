import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireSession } from "@/lib/leads/auth";
import { validateMediaFile, type MediaKind } from "@/lib/whatsapp/template-rules";

// Two modes:
//
// 1. JSON  { kind: "image"|"video"|"document", mime, size, name }
//    -> { path, token, signedUrl, publicUrl }
//    Direct-to-storage upload (preferred). The browser uploads the bytes
//    straight to Supabase Storage with supabase-js uploadToSignedUrl, so large
//    videos/PDFs never pass through Vercel (whose request bodies cap at 4.5 MB
//    and 413 before this route even runs). Used by
//    src/components/whatsapp/MediaUploader.tsx via src/lib/whatsapp/media-upload-client.ts.
//
// 2. multipart/form-data  (legacy byte proxy, below). Still used by the inbox
//    composer and Growth tab for small images; bodies over ~4.5 MB fail on Vercel.
//
// Upload a template header asset (image / video / document) to the public
// `wa-media` Supabase Storage bucket and return its public URL. The template
// builder hands this URL to Meta as the sample media when submitting for
// approval (header_media_url), and again at send time as the header.
//
// Meta sample-media limits enforced here so staff get an instant, friendly
// error instead of a cryptic Meta rejection hours later.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const LIMITS: Record<string, { mimes: RegExp; maxBytes: number; label: string }> = {
  IMAGE: { mimes: /^image\/(jpeg|png)$/, maxBytes: 5 * 1024 * 1024, label: "JPG or PNG, up to 5 MB" },
  VIDEO: { mimes: /^video\/mp4$/, maxBytes: 16 * 1024 * 1024, label: "MP4, up to 16 MB" },
  DOCUMENT: { mimes: /^application\/pdf$/, maxBytes: 100 * 1024 * 1024, label: "PDF, up to 100 MB" },
};

function slugify(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  return (stem || "asset") + ext;
}

const SIGNED_KINDS: MediaKind[] = ["image", "video", "document"];

async function signUpload(req: NextRequest): Promise<NextResponse> {
  const denied = await requireSession();
  if (denied) return denied;
  let body: { kind?: string; mime?: string; size?: number; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Could not read the upload request." }, { status: 400 });
  }
  const kind = String(body.kind ?? "").toLowerCase() as MediaKind;
  if (!SIGNED_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Choose an image, video or PDF." }, { status: 400 });
  }
  const problem = validateMediaFile(kind, { type: body.mime, size: Number(body.size) });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const path = `campaigns/${crypto.randomUUID()}-${slugify(String(body.name ?? "file"))}`;
  const { data, error } = await supabaseAdmin.storage.from("wa-media").createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: `Could not prepare the upload: ${error?.message ?? "unknown error"}` }, { status: 500 });
  }
  const { data: pub } = supabaseAdmin.storage.from("wa-media").getPublicUrl(path);
  return NextResponse.json({ path: data.path, token: data.token, signedUrl: data.signedUrl, publicUrl: pub.publicUrl });
}

export async function POST(req: NextRequest) {
  if ((req.headers.get("content-type") ?? "").includes("application/json")) return signUpload(req);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const format = String(form.get("format") ?? "").toUpperCase();
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  const rule = LIMITS[format];
  if (!rule) return NextResponse.json({ error: "format must be IMAGE, VIDEO or DOCUMENT" }, { status: 400 });

  const mime = file.type || "application/octet-stream";
  if (!rule.mimes.test(mime)) {
    return NextResponse.json({ error: `${format} must be ${rule.label}. Got ${mime}.` }, { status: 400 });
  }
  if (file.size > rule.maxBytes) {
    return NextResponse.json({ error: `File too large — ${format} limit is ${rule.label}.` }, { status: 400 });
  }

  // Content-addressed path: two different files with the same filename used to
  // overwrite each other (breaking already-approved templates that referenced
  // the old asset). A short content hash keeps re-uploads of the same file
  // idempotent while distinct content always gets its own URL.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const path = `campaigns/${hash}-${slugify(file.name)}`;

  const { error } = await supabaseAdmin.storage
    .from("wa-media")
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (error) return NextResponse.json({ error: `upload failed: ${error.message}` }, { status: 500 });

  const { data } = supabaseAdmin.storage.from("wa-media").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, mime, bytes: file.size, format });
}
