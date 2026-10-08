"use client";

// A header dropdown: the "⋯" menu for secondary page actions (04-ia.md: one
// primary button, everything else in a menu), or a labelled button that
// offers a few ways to do one thing ("Add knowledge" → Paste / Upload).
// UI only: each item runs the exact handler the page already had.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import m from "./menu.module.css";

export type HeaderMenuItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Shows a tick: for pick-one settings (a sound, say). */
  checked?: boolean;
};

export function HeaderMenu({
  items,
  label,
  trigger,
  triggerClass = "pm2-btn",
  heading,
}: {
  items: HeaderMenuItem[];
  /** Accessible name; also the visible text when no `trigger` is given and it is not the ⋯ menu. */
  label: string;
  /** Visible button content. Omit for the plain "⋯" button. */
  trigger?: ReactNode;
  triggerClass?: string;
  heading?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const isDots = trigger == null;
  return (
    <div className={`${m.wrap}${isDots ? "" : ` ${m.grow}`}`} ref={ref}>
      <button
        type="button"
        className={`${triggerClass}${isDots ? ` ${m.dots}` : ""}`}
        aria-label={isDots ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        title={isDots ? label : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {isDots ? <MoreHorizontal aria-hidden /> : trigger}
      </button>
      {open ? (
        <div className={m.menu} role="menu" aria-label={label}>
          {heading ? <div className={m.h}>{heading}</div> : null}
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role={it.checked == null ? "menuitem" : "menuitemradio"}
              aria-checked={it.checked == null ? undefined : it.checked}
              disabled={it.disabled}
              className={it.checked ? m.on : undefined}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default HeaderMenu;
