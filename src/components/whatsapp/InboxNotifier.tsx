"use client";

// Browser-side alerts for WhatsApp chats a human must answer. Mounted once in
// the dashboard layout so it runs on every dashboard page while a tab is open.
//
// A thread is "alertable" when it is in Human mode or assigned to me. Each
// time such a thread's last_inbound_at moves forward we play a short ping and
// (permission granted) show a browser Notification that deep-links to the
// thread. The tab title gets a "(N)" prefix while alertable threads have
// unread inbound messages.
//
// Nothing here touches the backend or any send path.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Thread } from "./types";

const MUTE_KEY = "wa_alerts_muted";
const POLL_MS = 5000;

export function isAlertsMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
export function setAlertsMuted(muted: boolean) {
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* private mode */ }
  window.dispatchEvent(new Event("wa-alerts-changed"));
}

export function threadLink(threadId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/dashboard/whatsapp?tab=inbox&thread=${encodeURIComponent(threadId)}`;
}

// Two-tone ping via WebAudio: no asset file, no network. Browsers only allow
// audio after a user gesture, so the AudioContext is created lazily and
// resumed on the first pointerdown anywhere on the page.
let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}
// Three synthesised tones. Each note = [frequency Hz, start offset s, length s].
const SOUND_KEY = "wa_alert_sound";
export type SoundId = "chime" | "pop" | "bell";
export const SOUNDS: Array<{ id: SoundId; label: string; notes: Array<[number, number, number]>; wave: OscillatorType }> = [
  { id: "chime", label: "Chime", wave: "sine", notes: [[880, 0, 0.22], [1175, 0.12, 0.22]] },
  { id: "pop", label: "Pop", wave: "triangle", notes: [[1320, 0, 0.09], [990, 0.07, 0.12]] },
  { id: "bell", label: "Bell", wave: "sine", notes: [[1568, 0, 0.5], [2093, 0.02, 0.35], [784, 0.02, 0.6]] },
];
export function getSound(): SoundId {
  try {
    const v = localStorage.getItem(SOUND_KEY) as SoundId | null;
    return SOUNDS.some((s) => s.id === v) ? (v as SoundId) : "chime";
  } catch { return "chime"; }
}
export function setSound(id: SoundId) {
  try { localStorage.setItem(SOUND_KEY, id); } catch { /* private mode */ }
  window.dispatchEvent(new Event("wa-alerts-changed"));
}

export function playPing(id: SoundId = getSound()) {
  const ctx = getCtx();
  if (!ctx) return;
  const sound = SOUNDS.find((s) => s.id === id) ?? SOUNDS[0];
  const run = () => {
    const t0 = ctx.currentTime;
    sound.notes.forEach(([freq, offset, len]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = sound.wave;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + len + 0.03);
    });
  };
  if (ctx.state === "suspended") ctx.resume().then(run).catch(() => {});
  else run();
}

export function alertable(t: Thread, me: string | null): boolean {
  return t.status === "human" || (!!me && t.assigned_to === me);
}

export default function InboxNotifier() {
  const [me, setMe] = useState<string | null>(null);
  const seen = useRef<Map<string, string | null> | null>(null);

  useEffect(() => {
    fetch("/api/team").then((r) => r.json()).then((j) => setMe(j.currentUserEmail ?? null)).catch(() => {});
    // Unlock audio on first gesture so a later ping is allowed to play.
    const unlock = () => { const c = getCtx(); if (c && c.state === "suspended") c.resume().catch(() => {}); };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const { data: threads = [] } = useQuery({
    queryKey: ["wa-alert-threads"],
    queryFn: async (): Promise<Thread[]> => {
      const r = await fetch("/api/whatsapp/threads?limit=60", { cache: "no-store" });
      if (!r.ok) return [];
      const j = await r.json();
      return j.threads ?? [];
    },
    refetchInterval: POLL_MS,
  });

  // Diff against the previous poll; first poll only seeds the baseline.
  useEffect(() => {
    if (!threads.length && !seen.current) return;
    const prev = seen.current;
    const next = new Map<string, string | null>();
    const fresh: Thread[] = [];
    for (const t of threads) {
      next.set(t.id, t.last_inbound_at);
      if (!prev) continue;
      const before = prev.get(t.id);
      const moved = !!t.last_inbound_at && (before === undefined || (before ?? "") < t.last_inbound_at);
      if (moved && t.last_message_direction === "inbound" && alertable(t, me)) fresh.push(t);
    }
    seen.current = next;
    if (!fresh.length || isAlertsMuted()) return;
    playPing();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const t of fresh.slice(0, 3)) {
        const title = `WhatsApp: ${t.contact?.name || t.contact?.phone || t.wa_id}`;
        const n = new Notification(title, {
          body: t.last_message_snippet ?? "New message",
          tag: `wa-thread-${t.id}`,
          icon: "/pm-logo-64.png",
        });
        n.onclick = () => { window.focus(); window.location.href = threadLink(t.id); n.close(); };
      }
    }
  }, [threads, me]);

  // Title badge for unread inbound on alertable threads.
  useEffect(() => {
    const n = threads.filter((t) => alertable(t, me) && (t.unread_count ?? 0) > 0).length;
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = n > 0 ? `(${n}) ${base}` : base;
    return () => { document.title = document.title.replace(/^\(\d+\)\s*/, ""); };
  }, [threads, me]);

  return null;
}

// Bell toggle for the WhatsApp page header. Turning alerts on asks for
// Notification permission and plays a test ping (the click is the gesture
// browsers need before audio may play).
export function AlertsToggle() {
  const [muted, setMuted] = useState(false);
  const [sound, setSoundState] = useState<SoundId>("chime");
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    const sync = () => {
      setMuted(isAlertsMuted());
      setSoundState(getSound());
      setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    };
    sync();
    window.addEventListener("wa-alerts-changed", sync);
    return () => window.removeEventListener("wa-alerts-changed", sync);
  }, []);

  const toggle = async () => {
    const canAsk = typeof Notification !== "undefined" && Notification.permission === "default";
    if (muted) {
      setAlertsMuted(false);
      playPing();
      if (canAsk) await Notification.requestPermission();
      window.dispatchEvent(new Event("wa-alerts-changed"));
    } else if (canAsk) {
      // Sound already on, notifications never asked: this click asks, it does not mute.
      await Notification.requestPermission();
      window.dispatchEvent(new Event("wa-alerts-changed"));
    } else {
      setAlertsMuted(true);
    }
  };

  const label = muted ? "Alerts off" : perm === "granted" ? "Alerts on" : "Sound on";
  const hint = muted
    ? "Click to turn on sound + browser notifications for Human-mode chats"
    : perm === "denied"
      ? "Sound only. Browser notifications are blocked for this site; allow them in the address-bar site settings"
      : perm === "granted"
        ? "Sound + browser notifications on. Click to mute"
        : "Sound on. Click again to allow browser notifications";

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    {!muted && (
      <select aria-label="Notification sound" value={sound} title="Pick a sound; it previews on change"
        onChange={(e) => { const id = e.target.value as SoundId; setSound(id); playPing(id); }}
        style={{
          padding: "6px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600,
          border: "1px solid var(--pm-border)", background: "var(--pm-card)", color: "var(--pm-ink)", cursor: "pointer",
        }}>
        {SOUNDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    )}
    <button type="button" onClick={toggle} title={hint} aria-pressed={!muted}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
        border: `1px solid ${muted ? "var(--pm-border)" : "var(--pm-green)"}`,
        background: muted ? "var(--pm-card)" : "var(--pm-green)",
        color: muted ? "var(--pm-muted)" : "#fff",
      }}>
      {muted ? "🔕" : "🔔"} {label}
    </button>
    </div>
  );
}
