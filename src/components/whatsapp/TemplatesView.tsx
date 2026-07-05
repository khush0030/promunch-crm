"use client";

// Templates tab of the WhatsApp dashboard: list, guided builder, media-header
// upload and submit-to-Meta flow. Extracted from dashboard/whatsapp/page.tsx (audit R5).

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Bold, Check, Code, CornerUpLeft, ExternalLink, FileText,
  Image as ImageIcon, Italic, Megaphone, Phone, Plus, RefreshCw, Send,
  Sparkles, Strikethrough, Trash2, Upload, Video, X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { templateVars } from "@/app/dashboard/whatsapp/format";
import type { Template, TemplateButton } from "./types";
import {
  BRAND, templateStatusColor, inputStyle, cardStyle, primaryBtn, smallBtn,
  chip, chipOn, fmtBtn,
} from "./styles";
import { Modal, Field, Pill } from "./primitives";
import { WhatsAppPreview } from "./WhatsAppPreview";

export default function TemplatesView() {
  const toast = useToast();
  const [list, setList] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [bodySamples, setBodySamples] = useState<Record<string, string>>({});
  const [headerSamples, setHeaderSamples] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /* Wrap the current body selection in a WhatsApp formatting mark. */
  function wrapBody(mark: string) {
    const el = bodyRef.current;
    const src = editing?.body ?? "";
    if (!el) { setEditing({ ...editing!, body: src + mark + "text" + mark }); return; }
    const s = el.selectionStart ?? src.length;
    const e = el.selectionEnd ?? src.length;
    const sel = src.slice(s, e) || "text";
    const next = src.slice(0, s) + mark + sel + mark + src.slice(e);
    setEditing({ ...editing!, body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + mark.length, s + mark.length + sel.length);
    });
  }

  async function uploadMedia(file: File, format: "IMAGE" | "VIDEO" | "DOCUMENT") {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("format", format);
      const r = await fetch("/api/whatsapp/media-upload", { method: "POST", body: fd });
      const j = await r.json();
      if (j.error) { toast.push({ kind: "error", text: j.error }); return; }
      setEditing((cur) => ({ ...cur!, header_type: format, header_media_url: j.url }));
    } finally { setUploading(false); }
  }

  function setHeaderKind(kind: "" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT") {
    setEditing((cur) => ({
      ...cur!,
      header_type: kind || null,
      header_text: kind === "TEXT" ? (cur?.header_text ?? "") : null,
      header_media_url: kind === "IMAGE" || kind === "VIDEO" || kind === "DOCUMENT" ? cur?.header_media_url ?? null : null,
    }));
  }

  function addButton(b: TemplateButton) {
    const cur = editing?.buttons ?? [];
    if (cur.length >= 3) { toast.push({ kind: "error", text: "Up to 3 buttons keeps marketing templates clean." }); return; }
    setEditing({ ...editing!, buttons: [...cur, b] });
  }
  function updateButton(i: number, patch: Partial<TemplateButton>) {
    const cur = [...(editing?.buttons ?? [])];
    cur[i] = { ...cur[i], ...patch } as TemplateButton;
    setEditing({ ...editing!, buttons: cur });
  }
  function removeButton(i: number) {
    setEditing({ ...editing!, buttons: (editing?.buttons ?? []).filter((_, j) => j !== i) });
  }

  async function load(): Promise<Template[]> {
    const r = await fetch("/api/whatsapp/templates");
    const j = await r.json();
    const templates: Template[] = j.templates ?? [];
    setList(templates);
    return templates;
  }
  // On open: load, and if anything is still in Meta review, silently sync so
  // approvals land without anyone having to click "Sync from Meta". Toast only
  // on an actual status change; errors stay silent (the manual button reports them).
  useEffect(() => {
    (async () => {
      const before = await load();
      if (!before.some((t) => t.status === "pending")) return;
      const r = await fetch("/api/whatsapp/templates/sync", { method: "POST" }).catch(() => null);
      const j = await r?.json().catch(() => null);
      if (!j || j.error || j.ok === false) return;
      const after = await load();
      const prev = new Map(before.map((t) => [`${t.name}:${t.language}`, t.status]));
      for (const t of after) {
        if (prev.get(`${t.name}:${t.language}`) !== "pending") continue;
        if (t.status === "approved")
          toast.push({ kind: "success", text: `Template “${t.name}” approved by Meta — ready to send.` });
        else if (t.status === "rejected")
          toast.push({ kind: "error", text: `Template “${t.name}” rejected by Meta${t.rejection_reason ? ": " + t.rejection_reason : ""}.` });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Open the builder, pre-filling variable samples from a saved template. */
  function open(t: Partial<Template> | null) {
    setEditing(t);
    const vars = Array.isArray(t?.variables) ? t!.variables : [];
    const bs: Record<string, string> = {};
    for (const v of vars) if (v?.name) bs[String(v.name)] = v.sample ?? "";
    setBodySamples(bs);
    setHeaderSamples({});
  }

  async function saveDraft() {
    if (!editing) return;
    setBusy(true);
    try {
      const r = await fetch("/api/whatsapp/templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editing, status: "draft" }),
      });
      const j = await r.json();
      if (j.error) { toast.push({ kind: "error", text: j.error }); return; }
      setEditing(null);
      load();
    } finally { setBusy(false); }
  }

  async function submitToMeta() {
    if (!editing) return;
    const isMedia = editing.header_type === "IMAGE" || editing.header_type === "VIDEO" || editing.header_type === "DOCUMENT";
    const bodyVars = templateVars(editing.body);
    const headerVars = editing.header_type === "TEXT" ? templateVars(editing.header_text) : [];
    if (bodyVars.some((n) => !bodySamples[n]?.trim()) ||
        headerVars.some((n) => !headerSamples[n]?.trim())) {
      toast.push({
        kind: "error",
        text: "Fill a sample value for every {{n}} variable — Meta needs them to review the template.",
      });
      return;
    }
    if (isMedia && !editing.header_media_url) {
      toast.push({ kind: "error", text: `Upload a ${editing.header_type!.toLowerCase()} for the header before submitting.` });
      return;
    }
    const badBtn = (editing.buttons ?? []).find(
      (b) => (b.type === "URL" && !b.url?.trim()) || (b.type === "PHONE_NUMBER" && !("phone_number" in b && b.phone_number?.trim())),
    );
    if (badBtn) { toast.push({ kind: "error", text: "Every button needs its link / phone number filled in." }); return; }
    if (!confirm("Submit this template to Meta for approval?\n\nMeta reviews it (usually minutes to a few hours). You can't send it to customers until it's approved.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/whatsapp/templates/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editing.name,
          category: editing.category,
          language: editing.language ?? "en",
          header_text: editing.header_type === "TEXT" ? editing.header_text || undefined : undefined,
          header_format: editing.header_type || undefined,
          header_media_url: isMedia ? editing.header_media_url : undefined,
          body: editing.body,
          footer: editing.footer || undefined,
          body_samples: bodyVars.map((n) => bodySamples[n]),
          header_samples: headerVars.map((n) => headerSamples[n]),
          buttons: (editing.buttons && editing.buttons.length) ? editing.buttons : undefined,
        }),
      });
      const j = await r.json();
      if (j.error || j.ok === false) {
        toast.push({
          kind: "error",
          text: "Meta rejected the submission: " + (j.error || j.results?.[0]?.error || "unknown error"),
        });
        return;
      }
      toast.push({
        kind: "success",
        text: "Submitted to Meta — pending review. Use “Sync from Meta” later to pick up the approval.",
      });
      setEditing(null);
      load();
    } finally { setBusy(false); }
  }

  async function syncFromMeta() {
    setSyncing(true);
    try {
      const r = await fetch("/api/whatsapp/templates/sync", { method: "POST" });
      const j = await r.json();
      if (j.error || j.ok === false) {
        toast.push({ kind: "error", text: "Sync failed: " + (j.error ?? "unknown") });
        return;
      }
      const synced = j.synced ?? [];
      const approved = synced.filter((s: any) => s.status === "approved").length;
      toast.push({
        kind: "success",
        text: `Synced ${synced.length} template(s) from Meta — ${approved} approved.`,
      });
      load();
    } finally { setSyncing(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete the local template row? (does not delete it at Meta)")) return;
    await fetch(`/api/whatsapp/templates/${id}`, { method: "DELETE" });
    load();
  }

  const bodyVars = templateVars(editing?.body);
  const headerVars = templateVars(editing?.header_text);
  const preview = (editing?.body ?? "").replace(/\{\{(\d+)\}\}/g, (_, n) => bodySamples[n] || `{{${n}}}`);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--pm-muted)" }}>
          Build a template, submit it to Meta, then send it once approved. Status is owned by Meta —
          use “Sync from Meta” to refresh approvals.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={syncFromMeta} disabled={syncing} style={smallBtn}>
            <RefreshCw size={14} /> {syncing ? "Syncing…" : "Sync from Meta"}
          </button>
          <button type="button" onClick={() => open({ category: "marketing", language: "en", body: "" })} style={primaryBtn}>
            <Plus size={14} /> New template
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
        {list.map((t) => (
          <div key={t.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>{t.name}</div>
              <Pill icon={t.category === "offer" ? Megaphone : FileText} label={t.category}
                bg="rgba(185,28,74,0.08)" color={BRAND} />
            </div>
            <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 8 }}>
              {t.language} · <span style={{ color: templateStatusColor[t.status] ?? "#92400e", fontWeight: 600 }}>
                {t.status}
              </span>
            </div>
            {t.header_text && <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{t.header_text}</div>}
            <div style={{ fontSize: 13, color: "var(--pm-ink)", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{t.body}</div>
            {t.footer && <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 6 }}>{t.footer}</div>}
            {t.status === "rejected" && t.rejection_reason && (
              <div style={{ fontSize: 11, color: "var(--pm-terra)", marginTop: 6 }}>
                <AlertTriangle size={11} style={{ verticalAlign: -1 }} /> Rejected: {t.rejection_reason}
              </div>
            )}
            {t.status === "pending" && (
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 6 }}>
                In Meta review — usually minutes to a few hours. This tab checks automatically when opened.
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button type="button" onClick={() => open(t)} style={smallBtn}>Edit / Resubmit</button>
              <button type="button" onClick={() => remove(t.id)} style={{ ...smallBtn, color: "var(--pm-terra)" }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "Edit template" : "New template"}>
          <Field label="Name (lowercase, digits, underscores)">
            <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="diwali_offer_2026" style={inputStyle} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Category">
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as any })} style={inputStyle}>
                <option value="marketing">Marketing</option>
                <option value="offer">Offer</option>
                <option value="utility">Utility</option>
                <option value="authentication">Authentication</option>
              </select>
            </Field>
            <Field label="Language">
              <input value={editing.language ?? "en"} onChange={(e) => setEditing({ ...editing, language: e.target.value })} style={inputStyle} />
            </Field>
          </div>
          {editing.id && (
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              Meta status:{" "}
              <span style={{ color: templateStatusColor[editing.status ?? ""] ?? "#92400e", fontWeight: 700 }}>
                {editing.status ?? "not submitted"}
              </span>
            </div>
          )}
          {/* Live preview — sticky so it stays visible while editing below */}
          <div style={{ position: "sticky", top: -20, zIndex: 5, background: "var(--pm-card)", padding: "4px 0 10px", marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--pm-muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={12} /> Live preview — exactly what the customer sees
            </div>
            <WhatsAppPreview headerType={editing.header_type} headerMediaUrl={editing.header_media_url}
              headerText={(editing.header_text ?? "").replace(/\{\{(\d+)\}\}/g, (_, n) => headerSamples[n] || `{{${n}}}`)}
              body={preview} footer={editing.footer} buttons={editing.buttons} />
          </div>

          {/* Header */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pm-ink)", marginBottom: 4 }}>Header (optional)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {(["", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as const).map((k) => (
              <button key={k || "none"} type="button" onClick={() => setHeaderKind(k)}
                style={{ ...chip, ...((editing.header_type ?? "") === k ? chipOn : {}) }}>
                {k === "IMAGE" && <ImageIcon size={13} />}{k === "VIDEO" && <Video size={13} />}
                {k === "DOCUMENT" && <FileText size={13} />}{k === "" ? "None" : k === "TEXT" ? "Text" : k[0] + k.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {editing.header_type === "TEXT" && (
            <div style={{ marginBottom: 10 }}>
              <input value={editing.header_text ?? ""} onChange={(e) => setEditing({ ...editing, header_text: e.target.value })}
                maxLength={60} placeholder="e.g. A new launch 🌱" style={inputStyle} />
              {headerVars.map((n) => (
                <div key={`h${n}`} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, width: 38, color: BRAND }}>{`{{${n}}}`}</span>
                  <input value={headerSamples[n] ?? ""} onChange={(e) => setHeaderSamples({ ...headerSamples, [n]: e.target.value })}
                    placeholder="sample value" style={{ ...inputStyle, marginBottom: 0 }} />
                </div>
              ))}
            </div>
          )}
          {(editing.header_type === "IMAGE" || editing.header_type === "VIDEO" || editing.header_type === "DOCUMENT") && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ ...smallBtn, display: "inline-flex", cursor: uploading ? "wait" : "pointer" }}>
                <Upload size={14} /> {uploading ? "Uploading…" : editing.header_media_url ? "Replace file" : `Upload ${editing.header_type.toLowerCase()}`}
                <input type="file" hidden disabled={uploading}
                  accept={editing.header_type === "IMAGE" ? "image/jpeg,image/png" : editing.header_type === "VIDEO" ? "video/mp4" : "application/pdf"}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f, editing.header_type as "IMAGE" | "VIDEO" | "DOCUMENT"); }} />
              </label>
              {editing.header_media_url && (
                <span style={{ fontSize: 11, color: "var(--pm-green)", marginLeft: 8 }}>
                  <Check size={11} style={{ verticalAlign: -1 }} /> uploaded
                </span>
              )}
              <div style={{ fontSize: 11, color: "var(--pm-hint)", marginTop: 4 }}>
                {editing.header_type === "IMAGE" ? "JPG or PNG, up to 5 MB" : editing.header_type === "VIDEO" ? "MP4, up to 16 MB" : "PDF, up to 100 MB"}
              </div>
            </div>
          )}

          {/* Body + formatting toolbar */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pm-ink)", marginBottom: 4 }}>Body</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 6, alignItems: "center" }}>
            <button type="button" onClick={() => wrapBody("*")} title="Bold  *text*" style={fmtBtn}><Bold size={14} /></button>
            <button type="button" onClick={() => wrapBody("_")} title="Italic  _text_" style={fmtBtn}><Italic size={14} /></button>
            <button type="button" onClick={() => wrapBody("~")} title="Strikethrough  ~text~" style={fmtBtn}><Strikethrough size={14} /></button>
            <button type="button" onClick={() => wrapBody("```")} title="Monospace  ```text```" style={fmtBtn}><Code size={14} /></button>
            <span style={{ marginLeft: "auto", fontSize: 11, color: (editing.body ?? "").length > 1024 ? "var(--pm-terra)" : "var(--pm-hint)" }}>
              {(editing.body ?? "").length}/1024
            </span>
          </div>
          <textarea ref={bodyRef} value={editing.body ?? ""} onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            rows={6} maxLength={1024}
            placeholder="Type your message. Select text and tap a format button. Use {{1}}, {{2}} for per-customer values."
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }} />
          {bodyVars.length > 0 && (
            <div style={{
              border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10, marginBottom: 10,
              background: "var(--pm-app)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Sample values — Meta needs one example per variable to review the template
              </div>
              {bodyVars.map((n) => (
                <div key={`b${n}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, width: 38, color: BRAND }}>{`{{${n}}}`}</span>
                  <input value={bodySamples[n] ?? ""} onChange={(e) => setBodySamples({ ...bodySamples, [n]: e.target.value })}
                    placeholder="example value" style={{ ...inputStyle, marginBottom: 0 }} />
                </div>
              ))}
            </div>
          )}

          <Field label="Footer (optional) — small grey line, no formatting">
            <input value={editing.footer ?? ""} onChange={(e) => setEditing({ ...editing, footer: e.target.value })}
              maxLength={60} placeholder="PROMUNCH · Your Munchy Pal" style={inputStyle} />
          </Field>

          {/* Buttons */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pm-ink)", marginBottom: 6 }}>Buttons (optional, up to 3)</div>
          {(editing.buttons ?? []).map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: BRAND, width: 42 }}>
                {b.type === "URL" ? "Link" : b.type === "PHONE_NUMBER" ? "Call" : "Reply"}
              </span>
              <input value={b.text} maxLength={25} placeholder="Label" onChange={(e) => updateButton(i, { text: e.target.value })}
                style={{ ...inputStyle, marginBottom: 0, flex: "0 0 110px" }} />
              {b.type === "URL" && (
                <input value={b.url} placeholder="https://promunch.in/…" onChange={(e) => updateButton(i, { url: e.target.value } as Partial<TemplateButton>)}
                  style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
              )}
              {b.type === "PHONE_NUMBER" && (
                <input value={b.phone_number} placeholder="+9198…" onChange={(e) => updateButton(i, { phone_number: e.target.value } as Partial<TemplateButton>)}
                  style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
              )}
              <button type="button" onClick={() => removeButton(i)} style={{ ...smallBtn, color: "var(--pm-terra)" }}><X size={13} /></button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <button type="button" style={smallBtn} onClick={() => addButton({ type: "URL", text: "Order Now", url: "" })}><ExternalLink size={13} /> Link</button>
            <button type="button" style={smallBtn} onClick={() => addButton({ type: "QUICK_REPLY", text: "Tell me more" })}><CornerUpLeft size={13} /> Quick reply</button>
            <button type="button" style={smallBtn} onClick={() => addButton({ type: "PHONE_NUMBER", text: "Call us", phone_number: "" })}><Phone size={13} /> Call</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--pm-hint)", marginBottom: 12 }}>
            “Save draft” keeps it local only. “Submit to Meta” sends it for approval — it can't reach customers until Meta approves it.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setEditing(null)} style={smallBtn}>Cancel</button>
            <button type="button" onClick={saveDraft} disabled={busy} style={smallBtn}>Save draft</button>
            <button type="button" onClick={submitToMeta} disabled={busy || !editing.name || !editing.body} style={primaryBtn}>
              <Send size={13} /> {busy ? "Working…" : "Submit to Meta"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
