"use client";
import { useEffect, useRef } from "react";

// One shared tooltip for the whole app. Any element with data-tip="..." shows
// it on hover (or keyboard focus); a single fixed div follows the pointer.
// Mount <TooltipLayer /> once (the dashboard layout); no provider needed.
export function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active: Element | null = null;

    const place = (cx: number, cy: number) => {
      const w = el.offsetWidth || 240;
      const h = el.offsetHeight || 30;
      const x = Math.max(8, Math.min(cx + 14, window.innerWidth - w - 8));
      const y = cy + 16 + h > window.innerHeight - 8 ? cy - h - 10 : cy + 16;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    const show = (target: Element | null) => {
      const t = target?.closest?.("[data-tip]") ?? null;
      const text = t?.getAttribute("data-tip");
      if (!t || !text) {
        active = null;
        el.classList.remove("on");
        return false;
      }
      if (t !== active) {
        active = t;
        el.textContent = text;
      }
      el.classList.add("on");
      return true;
    };
    const onOver = (e: PointerEvent) => {
      if (show(e.target as Element)) place(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (active) place(e.clientX, e.clientY);
    };
    const onFocus = (e: FocusEvent) => {
      if (show(e.target as Element) && active) {
        const r = active.getBoundingClientRect();
        place(r.left, r.bottom - 8);
      }
    };
    const hide = () => {
      active = null;
      el.classList.remove("on");
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, { capture: true });
    };
  }, []);

  return <div ref={ref} className="pm2-tip" role="tooltip" aria-hidden="true" />;
}

export default TooltipLayer;
