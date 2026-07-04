// Pure formatting helpers for the WhatsApp dashboard. Extracted from page.tsx
// (audit R5) so they are unit-testable and reusable across the split-out views.

export function msgTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${time}`;
}

// Latest of two timestamps — so the inbox row shows when we last *touched* the
// chat in either direction. Inbound-only timing hides proactive/bot sends to
// first-time recipients (no reply yet → no inbound → blank time).
export function mostRecent(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Distinct {{n}} placeholder indices in a template string, sorted numerically.
export function templateVars(s: string | null | undefined): string[] {
  const m = (s ?? "").match(/\{\{(\d+)\}\}/g) ?? [];
  return Array.from(new Set(m.map((x) => x.replace(/[{}]/g, "")))).sort((a, b) => +a - +b);
}
