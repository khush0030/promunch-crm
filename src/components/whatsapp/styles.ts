// Shared inline-style constants + status color maps for the WhatsApp dashboard.
// Extracted from dashboard/whatsapp/page.tsx (audit R5).

import type { CSSProperties } from "react";

export const BRAND = "var(--pm-green)";
export const WA_GREEN = "#25D366";

export const priorityStyle: Record<string, { bg: string; color: string }> = {
  urgent: { bg: "rgba(239,68,68,0.12)", color: "var(--pm-terra)" },
  high:   { bg: "rgba(249,115,22,0.12)", color: "var(--pm-gold)" },
  normal: { bg: "rgba(59,130,246,0.10)", color: "#1d4ed8" },
  low:    { bg: "rgba(107,114,128,0.10)", color: "var(--pm-muted)" },
};

export const ticketStatusStyle: Record<string, { bg: string; color: string; label: string }> = {
  open:     { bg: "rgba(245,183,49,0.14)", color: "#92400e", label: "Open" },
  pending:  { bg: "rgba(59,130,246,0.14)", color: "#1d4ed8", label: "Pending" },
  resolved: { bg: "rgba(16,185,129,0.14)", color: "var(--pm-green)", label: "Resolved" },
  closed:   { bg: "rgba(107,114,128,0.14)", color: "var(--pm-muted)", label: "Closed" },
  none:     { bg: "rgba(229,231,235,0.6)",  color: "var(--pm-muted)", label: "—" },
};

export const templateStatusColor: Record<string, string> = {
  approved: "var(--pm-green)", rejected: "var(--pm-terra)", disabled: "var(--pm-muted)",
  pending: "#92400e", draft: "var(--pm-muted)",
};

export const campaignStatusStyle: Record<string, { bg: string; color: string }> = {
  draft:     { bg: "rgba(229,231,235,0.7)",  color: "var(--pm-muted)" },
  scheduled: { bg: "rgba(59,130,246,0.12)",  color: "#1d4ed8" },
  sending:   { bg: "rgba(245,183,49,0.16)",  color: "#92400e" },
  completed: { bg: "rgba(16,185,129,0.14)",  color: "var(--pm-green)" },
  failed:    { bg: "rgba(239,68,68,0.12)",   color: "var(--pm-terra)" },
  cancelled: { bg: "rgba(229,231,235,0.7)",  color: "var(--pm-muted)" },
};

export const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 10px", border: "1px solid var(--pm-border)",
  borderRadius: 8, fontSize: 13, outline: "none", background: "var(--pm-card)", color: "var(--pm-ink)",
};
export const cardStyle: CSSProperties = {
  background: "var(--pm-card)", border: "1px solid var(--pm-border)", borderRadius: 12, padding: 14,
};
export const primaryBtn: CSSProperties = {
  padding: "8px 14px", borderRadius: 8, border: "none", background: BRAND,
  color: "var(--pm-card)", fontWeight: 600, fontSize: 13, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
};
export const smallBtn: CSSProperties = {
  padding: "6px 10px", borderRadius: 8, border: "1px solid var(--pm-border)",
  background: "var(--pm-card)", color: "var(--pm-ink)", fontSize: 12, fontWeight: 600,
  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
};
export const chip: CSSProperties = {
  padding: "5px 11px", borderRadius: 999, border: "1px solid var(--pm-border)",
  background: "var(--pm-card)", color: "var(--pm-ink)", fontSize: 12, fontWeight: 600,
  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
};
export const chipOn: CSSProperties = {
  background: "rgba(185,28,74,0.08)", borderColor: BRAND, color: BRAND,
};
export const fmtBtn: CSSProperties = {
  width: 30, height: 28, borderRadius: 6, border: "1px solid var(--pm-border)",
  background: "var(--pm-card)", color: "var(--pm-ink)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
