"use client";

// Bot knowledge → "Test a question". Type what a customer might ask and see
// what the WhatsApp bot would read to answer it, with the passages most
// likely to hold the answer.
//
// Dry run: one GET to /api/whatsapp/kb/ask. Nothing is sent, saved or
// claimed. It does not write the bot's reply: that wording comes from the
// wa-ai-reply edge function's own prompt, and showing a reply here would need
// a dry-run mode in that function (an edge change that needs the owner's
// approval first, AGENTS.md §4.2). Until then this is a retrieval preview.

import { useState, type FormEvent, type ReactNode } from "react";
import { BookOpen, FileText, Search } from "lucide-react";
import { Modal } from "./primitives";
import { inputStyle } from "./styles";
import k from "./KbView.module.css";

type AskResult = {
  question: string;
  plan: { mode: "whole" | "search"; totalChars: number; budget: number; docs: { id: string; name: string; chars: number }[] };
  passages: { docName: string; text: string; matched: string[] }[];
  search: { docName: string; text: string; similarity: number }[] | null;
  searchError: string | null;
};

function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i} className={k.hl}>{p}</mark> : p));
}

export function KbAskButton({ className = "pm2-btn" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Search size={15} aria-hidden /> Test a question
      </button>
      {open && <KbAskModal onClose={() => setOpen(false)} />}
    </>
  );
}

function KbAskModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<AskResult | null>(null);

  async function ask(e?: FormEvent) {
    e?.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/whatsapp/kb/ask?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `Check failed (${r.status})`);
      setRes(j as AskResult);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Check failed");
    } finally {
      setBusy(false);
    }
  }

  const plan = res?.plan;
  return (
    <Modal onClose={onClose} title="Test a question">
      <p className={k.askLead}>
        Type what a customer might ask. You see what the bot reads to answer it. Nothing is sent or saved.
      </p>
      <form onSubmit={ask} className={k.askForm}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={inputStyle}
          placeholder="Are your chips roasted or fried?"
          aria-label="Customer question"
          maxLength={300}
        />
        <button type="submit" className="pm2-btn pri" disabled={busy || !q.trim()}>
          {busy ? "Checking…" : "Check"}
        </button>
      </form>
      {err && <p className={k.err}>{err}</p>}

      {res && plan && (
        <div className={k.askOut}>
          <div className={k.askBlock}>
            <span className={k.askEye}>
              <BookOpen size={14} aria-hidden /> What the bot reads
            </span>
            {plan.docs.length === 0 ? (
              <p className={k.meta}>Nothing yet. With no documents the bot hands every question to the team.</p>
            ) : plan.mode === "whole" ? (
              <p className={k.meta}>
                All {plan.docs.length} {plan.docs.length === 1 ? "document" : "documents"} in full ({plan.totalChars.toLocaleString("en-IN")} of{" "}
                {plan.budget.toLocaleString("en-IN")} characters it can hold): {plan.docs.map((d) => d.name).join(", ")}.
              </p>
            ) : (
              <p className={k.meta}>
                The knowledge is bigger than the bot can hold at once ({plan.totalChars.toLocaleString("en-IN")} characters), so it reads the Master KB
                plus the sections closest in meaning to the question, shown below.
              </p>
            )}
          </div>

          {plan.mode === "search" && (
            <div className={k.askBlock}>
              <span className={k.askEye}>Sections found by meaning</span>
              {res.searchError ? (
                <p className={k.err}>Couldn&apos;t run the meaning search right now ({res.searchError}). The word matches below still show where the facts are.</p>
              ) : res.search && res.search.length ? (
                <ul className={k.askList}>
                  {res.search.slice(0, 6).map((c, i) => (
                    <li key={i}>
                      <b>
                        <FileText size={13} aria-hidden /> {c.docName}
                      </b>
                      <span className={k.askText}>{c.text.slice(0, 400)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={k.meta}>No close sections. The bot would read the Master KB only.</p>
              )}
            </div>
          )}

          <div className={k.askBlock}>
            <span className={k.askEye}>Where the answer most likely is</span>
            {res.passages.length ? (
              <ul className={k.askList}>
                {res.passages.map((p, i) => (
                  <li key={i}>
                    <b>
                      <FileText size={13} aria-hidden /> {p.docName}
                    </b>
                    <span className={k.askText}>{highlight(p.text, p.matched)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={k.meta}>
                No passage mentions these words. If the fact isn&apos;t in Bot knowledge, the bot says it will check with the team and opens a ticket.
                Add it with Add knowledge.
              </p>
            )}
          </div>

          <p className={k.askNote}>
            Matching here is by words, to help you check the facts are written down. The bot reads the full text above and writes its own
            reply. This preview does not write or send one.
          </p>
        </div>
      )}
    </Modal>
  );
}
