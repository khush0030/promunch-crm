"use client";

import { useRef, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { canSend } from "@/lib/pm/composer";
import c from "./composer.module.css";

const MIN_ROWS = 2;
const MAX_ROWS = 6;

// Reply composer shared by the thread panel and inline list-row reply.
// Grows with content up to 6 rows, then scrolls. On a laptop Enter sends and
// Shift+Enter adds a new line (the hint says so); Cmd/Ctrl+Enter still sends.
// On touch screens Enter is a new line and only the Send button sends. IME
// composition (e.g. Hindi keyboards) never sends mid-word. `disabledReason` (e.g. a closed 24h
// window) shows as a line above the action row AND blocks sending outright
// (both the Send button and ⌘/Ctrl+Enter) — the way out of that state is
// the `actions` slot (e.g. a Template button), not the text box. The
// busy/empty/disabledReason rule lives in the pure `canSend` helper so the
// button and the keyboard shortcut can never disagree.
export function Composer({
  placeholder,
  value,
  onChange,
  busy,
  disabledReason,
  actions,
  onSend,
  onAttach,
  attachment,
  reasonShownElsewhere = false,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  disabledReason?: string;
  actions: ReactNode;
  onSend: () => void;
  onAttach?: (f: File) => void;
  attachment?: { name: string } | null;
  /** the host already shows disabledReason (e.g. the 24h window bar); still blocks sending */
  reasonShownElsewhere?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const sendable = canSend({ busy, value, disabledReason, hasAttachment: !!attachment });

  const autoGrow = (el: HTMLTextAreaElement) => {
    const line = parseFloat(getComputedStyle(el).lineHeight || "20") || 20;
    el.style.height = "auto";
    const maxHeight = line * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    autoGrow(e.target);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const modifier = e.metaKey || e.ctrlKey;
    const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (modifier || (!e.shiftKey && !e.altKey && !touch)) {
      e.preventDefault();
      // Same rule as the button (canSend): never while a send is in flight.
      if (sendable) onSend();
    }
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && onAttach) onAttach(f);
    e.target.value = "";
  };

  return (
    <div className={`pm2-composer ${c.box}`}>
      <textarea
        rows={MIN_ROWS}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={busy}
        aria-label={placeholder}
      />
      {attachment ? <div className="attachment">📎 {attachment.name}</div> : null}
      {disabledReason && !reasonShownElsewhere ? <div className="reason">{disabledReason}</div> : null}
      <div className="row">
        {actions}
        {onAttach ? (
          <>
            <input ref={fileRef} type="file" hidden onChange={handleFile} />
            <button type="button" className="pm2-btn sm ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
              Attach
            </button>
          </>
        ) : null}
        <span className={c.hint}>Enter to send, Shift+Enter for new line</span>
        <button type="button" className={`pm2-btn pri ${c.send}`} onClick={onSend} disabled={!sendable}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

export default Composer;
