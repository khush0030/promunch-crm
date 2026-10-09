"use client";

// Ask Maya → Saved answers (prototype maya-saved + save-ans). Save names a
// question; opening a saved answer asks Maya again, so the numbers are fresh.
// Pin keeps it at the top of the list. Everything degrades away while the
// assistant_saved_answers table is missing (GET returns available:false).

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, Pin, PinOff, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/pm";
import { Modal } from "@/components/whatsapp/primitives";
import { useToast } from "@/components/ui/Toast";
import type { SavedAnswer } from "@/lib/assistant/saved";
import s from "./SavedAnswers.module.css";

type SavedResponse = { available: boolean; saved: SavedAnswer[] };

export function useSavedAnswers() {
  return useQuery({
    queryKey: ["assistant-saved"],
    queryFn: async (): Promise<SavedResponse> => {
      const r = await fetch("/api/assistant/saved", { cache: "no-store" });
      if (!r.ok) return { available: false, saved: [] };
      return (await r.json()) as SavedResponse;
    },
    staleTime: 30_000,
  });
}

export function SaveAnswerButton({
  question,
  answer,
  conversationId,
  className,
}: {
  question: string;
  answer: string;
  conversationId: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} disabled={done} aria-label="Save this answer">
        {done ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
        {done ? "Saved" : "Save"}
      </button>
      {open && (
        <SaveModal
          question={question}
          answer={answer}
          conversationId={conversationId}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setDone(true);
          }}
        />
      )}
    </>
  );
}

function SaveModal({
  question,
  answer,
  conversationId,
  onClose,
  onSaved,
}: {
  question: string;
  answer: string;
  conversationId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(question.slice(0, 120));
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/assistant/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, question, answer, conversation_id: conversationId, shared }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `Could not save (${r.status})`);
      qc.invalidateQueries({ queryKey: ["assistant-saved"] });
      toast.push({ kind: "success", text: "Saved to Saved answers" });
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Save this answer">
      <form onSubmit={save} className={s.form}>
        <p className={s.lead}>It asks Maya again with fresh numbers whenever someone opens it.</p>
        <label className={s.field}>
          <span>Name</span>
          <input className={s.in} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <label className={s.check}>
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Share with the team
        </label>
        {err && <p className={s.err}>{err}</p>}
        <div className={s.foot}>
          <button type="button" className="pm2-btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="pm2-btn pri" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function savedWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export function SavedAnswersList({ me, onOpen }: { me: string | null; onOpen: (question: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useSavedAnswers();
  const [del, setDel] = useState<SavedAnswer | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, method: "PATCH" | "DELETE", body?: unknown) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/assistant/saved/${id}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `Failed (${r.status})`);
      qc.invalidateQueries({ queryKey: ["assistant-saved"] });
      return true;
    } catch (e) {
      toast.push({ kind: "error", text: e instanceof Error ? e.message : "Failed" });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  if (q.isLoading) return <div className="pm2-skel" style={{ minHeight: 200 }} />;
  const rows = q.data?.saved ?? [];
  const mine = (r: SavedAnswer) => !!me && (r.created_by ?? "").toLowerCase() === me.toLowerCase();

  return (
    <>
      <p className={s.sum}>Questions you ask often. Each one asks Maya again with today&apos;s numbers when you open it.</p>
      <div className={s.card}>
        {rows.length === 0 ? (
          <div className={s.empty}>Nothing saved yet. Under any answer from Maya, press Save.</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className={s.row}>
              <button type="button" className={s.open} onClick={() => onOpen(r.question)}>
                <b>{r.name}</b>
                <span>
                  Saved by {mine(r) ? "you" : (r.created_by ?? "a teammate").split("@")[0]} · {savedWhen(r.created_at)}
                  {r.shared ? "" : " · only you"}
                </span>
              </button>
              {r.pinned && <span className={s.pinned}>Pinned</span>}
              <span className={s.acts}>
                <button
                  type="button"
                  className={s.icon}
                  aria-label={r.pinned ? "Unpin" : "Pin to the top"}
                  title={r.pinned ? "Unpin" : "Pin to the top"}
                  disabled={busyId === r.id}
                  onClick={() => act(r.id, "PATCH", { pinned: !r.pinned })}
                >
                  {r.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                </button>
                <button type="button" className={s.icon} aria-label="Delete saved answer" title="Delete" disabled={busyId === r.id} onClick={() => setDel(r)}>
                  <Trash2 size={16} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
      {del && (
        <ConfirmDialog
          title={`Delete "${del.name}"?`}
          body="It leaves Saved answers for the whole team. Conversations stay."
          confirmLabel="Delete"
          danger
          busy={busyId === del.id}
          onClose={() => setDel(null)}
          onConfirm={async () => {
            if (await act(del.id, "DELETE")) setDel(null);
          }}
        />
      )}
    </>
  );
}
