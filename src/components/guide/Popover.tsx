"use client";
// Internal toggletip used by HelpTip, GlossaryTerm and StepHeader chips.
// Not exported from the kit index; use HelpTip / GlossaryTerm instead.
//
// Behaviour:
//  - mouse hover opens (short delay), leaving closes unless pinned by a click
//  - keyboard focus opens; Enter/Space (click) pins it open; click again closes
//  - Escape closes and keeps focus on the trigger; outside click closes
//  - the bubble is position:fixed and clamped to the viewport (8px margin), so
//    it never overflows a 390px phone screen; it flips top/bottom when needed
//  - rendered inline (no portal) so Tab order runs trigger -> link inside it
//
// a11y: trigger has aria-expanded + aria-controls. A text-only bubble is a
// role="tooltip" wired via aria-describedby; a bubble with a link inside is a
// non-modal role="dialog" labelled by the trigger's accessible name.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import s from "./guide.module.css";

const MARGIN = 8;
const GAP = 8;

export function Popover({
  trigger,
  triggerClassName,
  ariaLabel,
  placement = "top",
  interactive = false,
  dialogLabel,
  children,
}: {
  trigger: ReactNode;
  triggerClassName: string;
  /** Accessible name for the trigger (omit when `trigger` is readable text). */
  ariaLabel?: string;
  placement?: "top" | "bottom";
  /** True when the bubble contains a link or button. */
  interactive?: boolean;
  /** Accessible name for the bubble when it is a dialog. Defaults to ariaLabel. */
  dialogLabel?: string;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  const clearTimer = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const close = useCallback(() => {
    clearTimer();
    pinned.current = false;
    setOpen(false);
  }, []);

  const place = useCallback(() => {
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(MARGIN, Math.min(r.left + r.width / 2 - w / 2, vw - w - MARGIN));
    const above = r.top - GAP - h;
    const below = r.bottom + GAP;
    let top = placement === "top" ? above : below;
    if (placement === "top" && above < MARGIN) top = below;
    if (placement === "bottom" && below + h > vh - MARGIN && above >= MARGIN) top = above;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(Math.max(MARGIN, top))}px`;
    pop.dataset.placed = "1";
  }, [placement]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = wrapRef.current?.contains(document.activeElement);
      close();
      if (inside) btnRef.current?.focus();
    };
    const onMove = () => place();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, { capture: true });
    };
  }, [open, close, place]);

  useEffect(() => clearTimer, []);

  const hoverIn = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimer();
    hoverTimer.current = setTimeout(() => setOpen(true), 120);
  };
  const hoverOut = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimer();
    if (!pinned.current) hoverTimer.current = setTimeout(() => setOpen(false), 180);
  };

  return (
    <span
      ref={wrapRef}
      className={s.popWrap}
      onPointerEnter={hoverIn}
      onPointerLeave={hoverOut}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className={triggerClassName}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open && !interactive ? id : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => {
          clearTimer();
          if (open && pinned.current) {
            close();
          } else {
            pinned.current = true;
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      <span
        ref={popRef}
        id={id}
        role={interactive ? "dialog" : "tooltip"}
        aria-label={interactive ? (dialogLabel ?? ariaLabel) : undefined}
        className={s.pop}
        hidden={!open}
      >
        {children}
      </span>
    </span>
  );
}
