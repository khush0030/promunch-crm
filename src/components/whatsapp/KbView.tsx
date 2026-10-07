"use client";

// Bot knowledge tab: the Master KB the WhatsApp bot (and email and B2B drafts)
// answer from. Documents are uploaded or pasted here; the kb-ingest edge
// function splits each one into sections and indexes them for search.
// Plain-words UI: "sections" not chunks, "Refresh what the bot knows" not
// re-ingest. The technical terms live in the HelpTips.

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, FileText, RefreshCw, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/pm";
import { HelpTip } from "@/components/guide";
import type { KbDoc } from "./types";
import { inputStyle } from "./styles";
import { Modal, Field } from "./primitives";
import k from "./KbView.module.css";

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

  const ready = docs.filter((d) => d.status === "ready").length;
  const newest = docs.reduce<string | null>((a, d) => (!a || d.created_at > a ? d.created_at : a), null);

  return (
    <div className={k.page}>
      <div className={k.head}>
        <div className={k.headText}>
          <p className={k.sum}>
            The only place the WhatsApp bot, email drafts and B2B emails learn facts from.{" "}
            {docs.length > 0 && (
              <>
                <b>{docs.length} {docs.length === 1 ? "document" : "documents"}</b>
                {newest ? `, last added ${addedWhen(newest)}.` : "."}
              </>
            )}
            <HelpTip text="Each document is split into short sections and indexed (embedded) so the bot can find the right part of it for each question. Email and B2B drafts use the same knowledge." />
          </p>
          {docs.length > 0 && ready < docs.length && (
            <p className={k.help}>{ready} of {docs.length} ready. The rest are still being read.</p>
          )}
        </div>
        <div className={k.acts}>
          <button type="button" onClick={() => setManualOpen(true)} className="pm2-btn"><FileText size={15} aria-hidden /> Paste text</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="pm2-btn pri" disabled={uploading}>
            <Upload size={15} aria-hidden /> {uploading ? "Uploading…" : "Upload a file"}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </div>
      </div>

      <div className={k.card}>
        {docs.length === 0 && (
          <div className={k.empty}>Nothing here yet. Upload a file or paste text so the bot has something to answer from.</div>
        )}
        {docs.map((d) => (
          <div key={d.id} className={k.row}>
            <span className={k.ic} aria-hidden><FileText /></span>
            <div className={k.tx}>
              <b className={k.name}>{d.name}</b>
              <span className={k.meta}>
                {SOURCE_LABEL[d.source_type] ?? d.source_type} · added {addedWhen(d.created_at)} · {d.chunk_count} section{d.chunk_count === 1 ? "" : "s"} the bot can search
              </span>
              {d.error && <span className={k.err}>Couldn&apos;t read it: {d.error}</span>}
            </div>
            <KbStatus s={d.status} />
            <div className={k.rowActs}>
              <button type="button" onClick={() => refresh(d)} className={k.iconBtn} aria-label={`Refresh what the bot knows from ${d.name}`} title="Read it again (use if the bot gives old answers)">
                <RefreshCw aria-hidden />
              </button>
              <button type="button" aria-label={`Delete ${d.name}`} title="Delete" onClick={() => setToDelete(d)} className={k.iconBtn}>
                <Trash2 aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className={k.note}>
        <Bot size={16} aria-hidden />
        <span>The bot never answers from its own memory. If a fact isn&apos;t here, it says it will check with the team and creates a ticket. The refresh button reads a document again if the bot seems to give old answers.</span>
      </p>

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
  const map: Record<KbDoc["status"], { cls: string; label: string }> = {
    ready: { cls: "good", label: "Bot knows this" },
    processing: { cls: "info", label: "Reading it" },
    pending: { cls: "neu", label: "Waiting to read" },
    failed: { cls: "crit", label: "Couldn't read" },
  };
  const m = map[s] ?? map.pending;
  return <span className={`pm2-pill ${m.cls} ${k.status}`}>{m.label}</span>;
}

// "today", "3 days ago", or "22 May" for older ones.
function addedWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!t) return "recently";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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
