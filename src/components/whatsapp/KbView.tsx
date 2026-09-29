"use client";

// Bot knowledge tab: the Master KB the WhatsApp bot (and email and B2B drafts)
// answer from. Documents are uploaded or pasted here; the kb-ingest edge
// function splits each one into sections and indexes them for search.
// Plain-words UI: "sections" not chunks, "Refresh what the bot knows" not
// re-ingest. The technical terms live in the HelpTips.

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, RefreshCw, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/pm";
import { HelpTip } from "@/components/guide";
import { timeAgo } from "@/app/dashboard/whatsapp/format";
import type { KbDoc } from "./types";
import { inputStyle, cardStyle } from "./styles";
import { Modal, Field } from "./primitives";

const SOURCE_LABEL: Record<string, string> = { upload: "Uploaded file", manual: "Pasted text", text: "Pasted text", url: "Web page" };

export default function KbView() {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [toDelete, setToDelete] = useState<KbDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      else toast.push({ kind: "success", text: `Added "${f.name}". The bot can use it in a minute or two.` });
      load();
    } finally { setUploading(false); }
  }

  async function refresh(d: KbDoc) {
    await fetch(`/api/whatsapp/kb/${d.id}`, { method: "POST" });
    toast.push({ kind: "success", text: `Refreshing "${d.name}". This takes a minute or two.` });
    load();
  }
  async function remove(d: KbDoc) {
    setDeleting(true);
    try {
      await fetch(`/api/whatsapp/kb/${d.id}`, { method: "DELETE" });
      load();
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--pm-muted)", maxWidth: 640, lineHeight: 1.5, minWidth: 0, flex: "1 1 280px" }}>
          <strong style={{ color: "var(--pm-ink)" }}>What the WhatsApp bot knows.</strong> The bot only answers from these
          documents, never from guesswork. Upload a PDF or text file, or paste text like a policy or FAQ. The bot can use it a
          minute or two later.
          <HelpTip text="Each document is split into short sections and indexed (embedded) so the bot can find the right part of it for each question. Email and B2B drafts use the same knowledge." />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setManualOpen(true)} className="pm2-btn"><FileText size={14} /> Paste text</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="pm2-btn pri" disabled={uploading}>
            <Upload size={14} /> {uploading ? "Uploading…" : "Upload a file"}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      </div>

      <div className="pm-autogrid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,280px),1fr))", gap: 12 }}>
        {docs.length === 0 && (
          <div style={{ gridColumn: "1/-1", padding: 32, textAlign: "center", color: "var(--pm-hint)", fontSize: 13 }}>
            Nothing here yet. Upload a file or paste text so the bot has something to answer from.
          </div>
        )}
        {docs.map((d) => (
          <div key={d.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{d.name}</div>
              <KbStatus s={d.status} />
            </div>
            <div style={{ fontSize: 12, color: "var(--pm-muted)", marginBottom: 8 }}>
              {SOURCE_LABEL[d.source_type] ?? d.source_type} · added {timeAgo(d.created_at)} ago
            </div>
            <div style={{ fontSize: 12, color: "var(--pm-ink)", display: "flex", alignItems: "center", gap: 2 }}>
              {d.chunk_count} section{d.chunk_count === 1 ? "" : "s"} the bot can search
              <HelpTip text="The document is split into short sections (chunks) so the bot can pick the exact part that answers a question." />
            </div>
            {d.error && <div style={{ fontSize: 11, color: "var(--pm-terra)", marginTop: 6 }}>Couldn&apos;t read it: {d.error}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => refresh(d)} className="pm2-btn sm">
                <RefreshCw size={12} /> Refresh what the bot knows
              </button>
              <HelpTip text="Reads this document again from the start. Use it if the bot seems to give old answers, or if reading failed." />
              <button type="button" aria-label={`Delete ${d.name}`} onClick={() => setToDelete(d)} className="pm2-btn sm ghost">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {manualOpen && <ManualKbModal onClose={() => { setManualOpen(false); load(); }} />}
      {toDelete && (
        <ConfirmDialog
          title={`Delete "${toDelete.name}"?`}
          body="The bot will stop using this document straight away. Customers asking about it may get a less complete answer. This can't be undone."
          confirmLabel="Delete" keepLabel="Cancel" danger busy={deleting}
          onClose={() => setToDelete(null)}
          onConfirm={() => remove(toDelete)}
        />
      )}
    </div>
  );
}

function KbStatus({ s }: { s: KbDoc["status"] }) {
  const map: Record<KbDoc["status"], { cls: string; icon: typeof CheckCircle2; label: string }> = {
    ready: { cls: "good", icon: CheckCircle2, label: "Bot knows this" },
    processing: { cls: "info", icon: RefreshCw, label: "Reading it…" },
    pending: { cls: "warn", icon: RefreshCw, label: "Waiting to read" },
    failed: { cls: "crit", icon: AlertTriangle, label: "Couldn't read" },
  };
  const m = map[s] ?? map.pending;
  return <span className={`pm2-pill plain ${m.cls}`}><m.icon size={11} aria-hidden="true" /> {m.label}</span>;
}

function ManualKbModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const r = await fetch("/api/whatsapp/kb", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "manual entry", text }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.error) throw new Error(j?.error || `Save failed (${r.status})`);
      onClose(); // close only on success so the pasted text isn't lost
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal onClose={onClose} title="Paste something the bot should know">
      <Field label="Title (so your team can find it)"><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Return policy" /></Field>
      <Field label="Text">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
          placeholder="Paste an FAQ, a policy, or product facts exactly as they are on the pack" />
      </Field>
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} className="pm2-btn">Cancel</button>
        <button type="button" onClick={save} disabled={saving || !text.trim()} className="pm2-btn pri">{saving ? "Adding…" : "Add to bot knowledge"}</button>
      </div>
    </Modal>
  );
}
