"use client";

// Bits shared by the WhatsApp and Instagram conversation views: the
// not-found card, the assign menu, the copy-link helper and the thread PATCH
// helper. None of these message a customer.

import Link from "next/link";
import type { TeamMember } from "@/components/whatsapp/types";

type Toast = { push: (t: { kind: "info" | "success" | "error"; text: string }) => void };

export function NotFoundCard() {
  return (
    <div className="pm2-body">
      <div className="pm2-panel" style={{ padding: 20 }}>
        <b>This conversation was not found</b>
        <div style={{ marginTop: 6 }}>
          <Link className="pm2-lnk" href="/dashboard/inbox">Back to Inbox</Link>
        </div>
      </div>
    </div>
  );
}

/** Small inline line shown above the composer while a poll is failing. */
export function ConnectionNotice() {
  return (
    <div className="pm2-thread-notice" role="status">
      Connection problem, retrying…
    </div>
  );
}

export function AssignSelect({
  value,
  members,
  disabled,
  onChange,
}: {
  value: string | null;
  members: TeamMember[];
  disabled?: boolean;
  onChange: (email: string) => void;
}) {
  return (
    <select
      aria-label="Assigned to"
      className="pm2-btn sm"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ appearance: "auto", cursor: "pointer" }}
    >
      <option value="">Unassigned</option>
      {members.filter((m) => m.email).map((m) => (
        <option key={m.id} value={m.email!}>{m.name}</option>
      ))}
    </select>
  );
}

/** Copy a conversation link for a teammate; falls back to a prompt when the clipboard is blocked. */
export async function shareLink(path: string, toast: Toast) {
  const url = `${window.location.origin}${path}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.push({ kind: "success", text: "Chat link copied." });
  } catch {
    window.prompt("Copy this chat link", url);
  }
}

/** PATCH a thread route; surfaces the route's error as a toast. Returns true on success. */
export async function patchThread(url: string, body: Record<string, unknown>, toast: Toast): Promise<boolean> {
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    toast.push({ kind: "error", text: "Could not update: " + (j.error ?? `HTTP ${r.status}`) });
    return false;
  }
  return true;
}
