"use client";

// Reusable WhatsApp media picker: validates size/type before uploading,
// uploads straight to storage (no Vercel body limit), shows a preview and
// lets the user replace or remove the file. Generic on purpose: template
// headers use it today, per-campaign images can reuse it.

import { useId, useRef, useState } from "react";
import { AlertTriangle, FileText, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { MEDIA_LIMITS, type MediaKind } from "@/lib/whatsapp/template-rules";
import { uploadWaMedia, type UploadedMedia } from "@/lib/whatsapp/media-upload-client";
import { smallBtn } from "./styles";

const KIND_LABEL: Record<MediaKind, string> = { image: "image", video: "video", document: "PDF" };

export function MediaUploader({
  kind,
  value,
  onChange,
  disabled,
  label,
}: {
  kind: MediaKind;
  value: string | null | undefined;
  /** Called with the public URL (and file details) after upload, or null on remove. */
  onChange: (url: string | null, media?: UploadedMedia) => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rule = MEDIA_LIMITS[kind];

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy({ name: file.name, size: file.size });
    try {
      const media = await uploadWaMedia(file, kind);
      onChange(media.url, media);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed. Try again.");
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const btnLabel = value ? `Replace ${KIND_LABEL[kind]}` : `Upload ${KIND_LABEL[kind]}`;

  return (
    <div style={{ marginBottom: 10 }}>
      {label && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pm-ink)", marginBottom: 4 }}>{label}</div>}

      {value && !busy && (
        <div style={{ marginBottom: 8, maxWidth: 280 }}>
          {kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Uploaded header" style={{ width: "100%", borderRadius: 8, border: "1px solid var(--pm-border)", display: "block" }} />
          )}
          {kind === "video" && (
            <video src={value} controls style={{ width: "100%", borderRadius: 8, border: "1px solid var(--pm-border)", display: "block" }} />
          )}
          {kind === "document" && (
            <a href={value} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--pm-ink)" }}>
              <FileText size={14} /> Open the uploaded PDF
            </a>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor={inputId} style={{ ...smallBtn, cursor: busy || disabled ? "wait" : "pointer", opacity: disabled ? 0.6 : 1 }}>
          {busy ? <Loader2 size={14} /> : value ? <RefreshCw size={14} /> : <Upload size={14} />}
          {busy ? "Uploading..." : btnLabel}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          hidden
          disabled={!!busy || disabled}
          accept={rule.accept}
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {value && !busy && (
          <button type="button" onClick={() => { setError(null); onChange(null); }} disabled={disabled}
            style={{ ...smallBtn, color: "var(--pm-terra)" }}>
            <Trash2 size={13} /> Remove
          </button>
        )}
        {busy && (
          <span style={{ fontSize: 12, color: "var(--pm-muted)" }}>
            {busy.name} ({(busy.size / (1024 * 1024)).toFixed(1)} MB). Keep this window open.
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--pm-hint)", marginTop: 4 }}>{rule.label}</div>
      {error && (
        <div role="alert" style={{ fontSize: 13, color: "var(--pm-terra)", marginTop: 6, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}
    </div>
  );
}
