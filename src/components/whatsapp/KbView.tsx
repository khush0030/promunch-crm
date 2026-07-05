"use client";

// Knowledge-base tab of the WhatsApp dashboard: KB document list, upload and
// paste-text flows. Extracted from dashboard/whatsapp/page.tsx (audit R5).

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, RefreshCw, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { timeAgo } from "@/app/dashboard/whatsapp/format";
import type { KbDoc } from "./types";
import { inputStyle, cardStyle, primaryBtn, smallBtn } from "./styles";
import { Modal, Field } from "./primitives";

export default function KbView() {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Replaces the old load() + mount effect + 6s setInterval poll.
  const { data: docs = [], refetch } = useQuery({
    queryKey: ["wa-kb-documents"],
    queryFn: async (): Promise<KbDoc[]> => {
      const r = await fetch("/api/whatsapp/kb");
      const j = await r.json();
      return j.documents ?? [];
    },
    refetchInterval: 6000,
  });
  const load = () => refetch();

  async function upload(f: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("name", f.name);
      const r = await fetch("/api/whatsapp/kb", { method: "POST", body: fd });
      const j = await r.json();
      if (j.error) toast.push({ kind: "error", text: j.error });
      load();
    } finally { setUploading(false); }
  }

  async function reingest(id: string) {
    await fetch(`/api/whatsapp/kb/${id}`, { method: "POST" });
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete document and all embeddings?")) return;
    await fetch(`/api/whatsapp/kb/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--pm-muted)" }}>
          Documents feed the AI agent. Upload PDFs/TXT or paste content. PDFs are parsed, chunked, and embedded.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setManualOpen(true)} style={smallBtn}><FileText size={14} /> Paste text</button>
          <button onClick={() => fileRef.current?.click()} style={primaryBtn} disabled={uploading}>
            <Upload size={14} /> {uploading ? "Uploading…" : "Upload PDF"}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
        {docs.length === 0 && (
          <div style={{ gridColumn: "1/-1", padding: 32, textAlign: "center", color: "var(--pm-hint)", fontSize: 13 }}>
            No documents yet. Upload to start training the AI agent.
          </div>
        )}
        {docs.map((d) => (
          <div key={d.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
              <KbStatus s={d.status} />
            </div>
            <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 8 }}>
              {d.source_type} · {d.mime_type ?? "—"}
            </div>
            <div style={{ fontSize: 12, color: "var(--pm-ink)" }}>
              {d.chunk_count} chunks · {timeAgo(d.created_at)} ago
            </div>
            {d.error && <div style={{ fontSize: 11, color: "var(--pm-terra)", marginTop: 6 }}>{d.error}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button onClick={() => reingest(d.id)} style={smallBtn}><RefreshCw size={12} /> Re-ingest</button>
              <button onClick={() => remove(d.id)} style={{ ...smallBtn, color: "var(--pm-terra)" }}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      {manualOpen && <ManualKbModal onClose={() => { setManualOpen(false); load(); }} />}
    </div>
  );
}

function KbStatus({ s }: { s: KbDoc["status"] }) {
  const map: Record<KbDoc["status"], { c: string; bg: string; icon: any }> = {
    ready:      { c: "var(--pm-green)", bg: "rgba(16,185,129,0.12)", icon: CheckCircle2 },
    processing: { c: "#1d4ed8", bg: "rgba(59,130,246,0.12)", icon: RefreshCw },
    pending:    { c: "#92400e", bg: "rgba(245,183,49,0.12)", icon: RefreshCw },
    failed:     { c: "var(--pm-terra)", bg: "rgba(239,68,68,0.12)",  icon: AlertTriangle },
  };
  const m = map[s];
  const I = m.icon;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: m.bg, color: m.c, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999 }}>
      <I size={11} /> {s}
    </span>
  );
}

function ManualKbModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    await fetch("/api/whatsapp/kb", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "manual entry", text }),
    });
    setSaving(false);
    onClose();
  }
  return (
    <Modal onClose={onClose} title="Paste knowledge">
      <Field label="Title"><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Return policy" /></Field>
      <Field label="Content">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
          placeholder="Paste FAQ, policy, product info…" />
      </Field>
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={smallBtn}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? "Saving…" : "Ingest"}</button>
      </div>
    </Modal>
  );
}
