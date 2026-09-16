"use client";

import { useCallback, useEffect, useRef } from "react";

// In-app confirm dialog — never window.confirm (customer-facing consequence
// on every path: a real WhatsApp send, or a real Shopify cancel).
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  keepLabel = "Keep",
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: React.ReactNode;
  body: React.ReactNode;
  confirmLabel: string;
  keepLabel?: string;
  danger?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Focus the safe action on open, restore focus to whatever opened the
  // dialog on close (this component only ever unmounts to close, so the
  // cleanup below runs on both unmount and a changed onClose identity).
  useEffect(() => {
    openerRef.current = document.activeElement;
    keepRef.current?.focus();
    return () => {
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        // Simple two-item focus trap: Keep and the primary action are the
        // only focusable elements, so Tab/Shift+Tab just bounces between them.
        e.preventDefault();
        const next = document.activeElement === keepRef.current ? confirmRef.current : keepRef.current;
        next?.focus();
      }
    },
    [onClose],
  );

  return (
    <div className="pm2-dialog-backdrop" onClick={onClose}>
      <div
        className="pm2-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="t">{title}</div>
        <div className="c">{body}</div>
        <div className="act">
          <button type="button" ref={keepRef} className="pm2-btn" onClick={onClose} disabled={busy}>
            {keepLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className="pm2-btn pri"
            style={danger ? { background: "var(--pm-terra)", borderColor: "var(--pm-terra)", color: "#fff" } : undefined}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
