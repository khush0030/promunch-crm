"use client";

// Live chats header: one quiet "Alerts on / Alerts off" button (tickets.html
// #tk-chats) plus a ⋯ menu for the sound. Same behaviour as AlertsToggle in
// whatsapp/InboxNotifier.tsx (same localStorage keys, same permission ask,
// same test ping); only the look changed. Green is reserved for good status,
// so the button stays neutral either way and the state is its words.

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import {
  SOUNDS,
  getSound,
  isAlertsMuted,
  playPing,
  setAlertsMuted,
  setSound,
  type SoundId,
} from "@/components/whatsapp/InboxNotifier";
import { HeaderMenu } from "./HeaderMenu";

export function AlertsControl() {
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

  // Identical to AlertsToggle.toggle.
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

  const hint = muted
    ? "Click to turn on sound + browser notifications for chats that need a human"
    : perm === "denied"
      ? "Sound only. Browser notifications are blocked for this site; allow them in the address-bar site settings"
      : perm === "granted"
        ? "Sound + browser notifications on. Click to mute"
        : "Sound on. Click again to allow browser notifications";

  return (
    <>
      <button type="button" className="pm2-btn" onClick={toggle} title={hint} aria-pressed={!muted}>
        {muted ? <BellOff aria-hidden /> : <Bell aria-hidden />}
        {muted ? "Alerts off" : "Alerts on"}
      </button>
      {!muted && (
        <HeaderMenu
          label="Alert sound"
          heading="Alert sound"
          items={SOUNDS.map((sd) => ({
            key: sd.id,
            label: sd.label,
            checked: sd.id === sound,
            onSelect: () => {
              setSound(sd.id);
              playPing(sd.id);
            },
          }))}
        />
      )}
    </>
  );
}

export default AlertsControl;
