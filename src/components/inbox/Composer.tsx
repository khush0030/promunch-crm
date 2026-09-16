"use client";

import { useRef, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { canSend } from "@/lib/pm/composer";

const MIN_ROWS = 2;
const MAX_ROWS = 6;

// Reply composer shared by the thread panel and inline list-row reply.
// Grows with content up to 6 rows, then scrolls. Plain Enter inserts a
// newline (textarea default); ⌘/Ctrl+Enter sends, matching the WhatsApp/
// email clients staff already use. `disabledReason` (e.g. a closed 24h
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
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const sendable = canSend({ busy, value, disabledReason });

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
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (sendable) onSend();
    }
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && onAttach) onAttach(f);
    e.target.value = "";
  };

  return (
    <div className="pm2-composer">
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
      {disabledReason ? <div className="reason">{disabledReason}</div> : null}
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
        <button type="button" className="pm2-btn pri sm" style={{ marginLeft: "auto" }} onClick={onSend} disabled={!sendable}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

export default Composer;
