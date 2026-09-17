"use client";

// Approved-template picker for a WhatsApp conversation composer. Extracted
// verbatim from src/components/whatsapp/InboxView.tsx (Task 2.5) so the old
// inbox and the new Inbox conversation view share one implementation.

import { useEffect, useMemo, useState } from "react";
import type { Template } from "@/components/whatsapp/types";
import { BRAND } from "@/components/whatsapp/styles";

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isMobile;
}

export function TemplatePicker({ templates, onCancel, onSend, busy }: {
  templates: Template[]; onCancel: () => void; onSend: (t: Template, vars: Record<string, string>) => void; busy?: boolean;
}) {
  const isMobile = useIsMobile();
  const [pick, setPick] = useState<Template | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const varNames = useMemo(() => {
    if (!pick) return [];
    const m = pick.body.match(/\{\{(\d+)\}\}/g) ?? [];
    return Array.from(new Set(m.map((s) => s.replace(/[{}]/g, ""))));
  }, [pick]);
  const preview = useMemo(() => {
    if (!pick) return "";
    return pick.body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[n] ?? `{{${n}}}`);
  }, [pick, vars]);

  return (
    <div style={{ padding: 12, borderTop: "1px solid var(--pm-border)", maxHeight: 320, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Send approved template</strong>
        <button type="button" onClick={onCancel} style={{ background: "none", border: "none", color: "var(--pm-muted)", cursor: "pointer" }}>Cancel</button>
      </div>
      {!pick && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
          {templates.length === 0 && <div style={{ fontSize: 12, color: "var(--pm-hint)" }}>No approved templates yet.</div>}
          {templates.map((t) => (
            <button type="button" key={t.id} onClick={() => setPick(t)} style={{
              textAlign: "left", padding: 10, borderRadius: 8, border: "1px solid var(--pm-border)",
              background: "var(--pm-card)", cursor: "pointer",
            }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "var(--pm-muted)", marginTop: 2 }}>{t.category} · {t.language}</div>
              <div style={{ fontSize: 12, color: "var(--pm-ink)", marginTop: 6, lineHeight: 1.3 }}>
                {t.body.slice(0, 100)}{t.body.length > 100 ? "…" : ""}
              </div>
            </button>
          ))}
        </div>
      )}
      {pick && (
        <div>
          <div style={{ marginBottom: 8, fontSize: 13 }}><strong>{pick.name}</strong> ({pick.language})</div>
          {varNames.map((n) => (
            <input key={n} placeholder={`{{${n}}}`} value={vars[n] ?? ""}
              onChange={(e) => setVars({ ...vars, [n]: e.target.value })}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--pm-border)", borderRadius: 8, marginBottom: 6, fontSize: 13 }} />
          ))}
          <div style={{ background: "var(--pm-app)", border: "1px solid var(--pm-border)", borderRadius: 8, padding: 10, fontSize: 13, whiteSpace: "pre-wrap", marginBottom: 8 }}>
            {preview}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setPick(null)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--pm-border)", background: "var(--pm-card)", cursor: "pointer", fontSize: 13 }}>Back</button>
            <button type="button" disabled={busy} onClick={() => onSend(pick, vars)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: BRAND, color: "var(--pm-card)", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1, fontWeight: 600, fontSize: 13 }}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
