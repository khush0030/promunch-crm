"use client";

import { useEffect } from "react";
import s from "./b2b.module.css";

// Plain, spacious dialog shell for the B2B flow. Escape and backdrop close.
export default function Dialog({ title, onClose, children, label }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; label?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : undefined)} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
