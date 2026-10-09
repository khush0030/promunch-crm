"use client";

// One gate for every alert sound and browser pop-up in the CRM, shared by the
// header bell (NotificationAlerter) and the Inbox live-chat pinger
// (whatsapp/InboxNotifier). It mirrors the signed-in user's saved
// preferences (Settings → My profile → Notifications) and makes sure one
// burst of activity rings once, never twice for the same event.

import { shouldRing } from "./state";

let soundOn = true;
let popupsOn = true;
let lastRing: number | null = null;

export function setAlertPrefs(p: { sound: boolean; popups: boolean }) {
  soundOn = p.sound;
  popupsOn = p.popups;
}
export function alertSoundOn(): boolean {
  return soundOn;
}
export function alertPopupsOn(): boolean {
  return popupsOn;
}

// Runs `play` unless sound is off or something already rang a moment ago.
// Returns whether it rang.
export function ringOnce(play: () => void, now = Date.now()): boolean {
  if (!soundOn || !shouldRing(lastRing, now)) return false;
  lastRing = now;
  try {
    play();
  } catch {
    /* audio blocked: never break the page */
  }
  return true;
}

export function canPopup(): boolean {
  return popupsOn && typeof Notification !== "undefined" && Notification.permission === "granted";
}
