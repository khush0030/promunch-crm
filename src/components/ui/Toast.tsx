"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Toast = { id: number; kind: "info" | "success" | "error"; text: string };
type Ctx = { push: (t: Omit<Toast, "id">) => void };

const ToastCtx = createContext<Ctx | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    return {
      push: (t: Omit<Toast, "id">) => {
        if (typeof window !== "undefined") {
          // Fallback if provider isn't mounted
          // eslint-disable-next-line no-alert
          alert(t.text);
        }
      },
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 1000,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pill ${t.kind === "success" ? "green" : t.kind === "error" ? "accent" : "blue"}`}
            style={{
              pointerEvents: "auto",
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              boxShadow: "var(--card-shadow)",
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
