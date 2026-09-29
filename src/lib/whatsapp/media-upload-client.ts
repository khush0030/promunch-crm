"use client";

// Browser helper: upload a WhatsApp media file straight to Supabase Storage
// (bucket wa-media) with a signed upload URL from /api/whatsapp/media-upload.
// The bytes never pass through Vercel, so 16 MB videos and large PDFs work.
// Every failure throws an Error with a plain-English message for the UI.

import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { validateMediaFile, type MediaKind } from "./template-rules";

export type UploadedMedia = { url: string; path: string; mime: string; size: number; name: string };

export async function uploadWaMedia(file: File, kind: MediaKind): Promise<UploadedMedia> {
  const problem = validateMediaFile(kind, { type: file.type, size: file.size, name: file.name });
  if (problem) throw new Error(problem);

  let signed: { path?: string; token?: string; publicUrl?: string; error?: string };
  try {
    const r = await fetch("/api/whatsapp/media-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, mime: file.type, size: file.size, name: file.name }),
    });
    signed = await r.json().catch(() => ({ error: `The server answered ${r.status}.` }));
    if (!r.ok && !signed.error) signed.error = `The server answered ${r.status}.`;
    if (r.status === 401) signed.error = "Your session has expired. Refresh the page and sign in again.";
  } catch {
    throw new Error("Could not reach the server. Check your internet connection and try again.");
  }
  if (signed.error || !signed.path || !signed.token || !signed.publicUrl) {
    throw new Error(signed.error ?? "Could not prepare the upload.");
  }

  try {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.storage
      .from("wa-media")
      .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
    if (error) {
      const msg = /exceeded|too large|maximum allowed size|413/i.test(error.message)
        ? "The file is larger than our storage allows. Compress it and try again."
        : `Upload failed: ${error.message}`;
      throw new Error(msg);
    }
  } catch (e) {
    if (e instanceof Error && /^(Upload failed|The file is larger)/.test(e.message)) throw e;
    throw new Error("The upload was interrupted. Check your internet connection and try again.");
  }

  return { url: signed.publicUrl, path: signed.path, mime: file.type, size: file.size, name: file.name };
}
