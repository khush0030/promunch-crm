"use client";

// Small shared UI primitives for the WhatsApp dashboard. Extracted from
// dashboard/whatsapp/page.tsx (audit R5).

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--pm-card)", borderRadius: 12, padding: 20, width: "min(560px,92vw)", maxHeight: "88vh", overflowY: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--pm-ink)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
