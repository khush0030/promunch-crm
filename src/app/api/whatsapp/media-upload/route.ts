import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

export async function POST(req: NextRequest) {
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
