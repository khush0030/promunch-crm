"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useAccess } from "@/components/shell/useAccess";
import { isAlertsMuted, playPing } from "@/components/whatsapp/InboxNotifier";
import { canUse } from "@/lib/access";
import { canPopup, ringOnce, setAlertPrefs } from "@/lib/notifications/alert-gate";
import { freshAlerts, type NotifState } from "@/lib/notifications/state";
import { useNotificationFeed, type FeedItem } from "./useNotifications";

// Rings for NEW unread notifications. Mounted once in the shell. On each poll
// it diffs item ids against the previous poll (the first poll only sets the
// baseline), keeps the ones in groups the user wants alerts for, and then:
//   - one sound per burst (shared gate with the Inbox chat pinger),
//   - a browser pop-up if allowed and the tab is in the background,
//   - otherwise a quiet toast.
// Chat items are skipped while the Inbox chat pinger is on for this user: it
// already rang for that message within 5 seconds. (InboxNotifier also
// unlocks the shared AudioContext on the first click anywhere.)
export default function NotificationAlerter() {
  const { data } = useNotificationFeed();
  const access = useAccess();
  const toast = useToast();
  const router = useRouter();
  const prevIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (data) setAlertPrefs(data.prefs);
  }, [data]);

  // Latest values for the ring effect, which should run once per new poll only.
  const ctx = useRef({ access, toast, router });
  useEffect(() => {
    ctx.current = { access, toast, router };
  });

  useEffect(() => {
    if (!data) return;
    const state: NotifState = { seen_at: data.seen_at, read: [], dismissed: [], prefs: data.prefs };
    // Server already applied read/dismissed: unread=false items are filtered here.
    const candidates = data.items.filter((i) => i.unread);
    let fresh: FeedItem[] = freshAlerts(prevIds.current, candidates, state);
    prevIds.current = new Set(data.items.map((i) => i.id));

    const { access, toast, router } = ctx.current;
    const chatPingerOn = !!access && canUse(access, "inbox") && !isAlertsMuted();
    if (chatPingerOn) fresh = fresh.filter((i) => i.kind !== "chat");
    if (!fresh.length) return;

    ringOnce(() => playPing());

    const background = document.hidden || !document.hasFocus();
    if (background && canPopup()) {
      for (const it of fresh.slice(0, 3)) {
        try {
          const n = new Notification(it.title, { body: it.body, tag: `pm-${it.id}`, icon: "/pm-logo-64.png" });
          n.onclick = () => {
            window.focus();
            router.push(it.href);
            n.close();
          };
        } catch {
          /* some browsers only allow pop-ups from a service worker */
        }
      }
    } else {
      toast.push({
        kind: "info",
        text: fresh.length === 1 ? fresh[0].title : `${fresh.length} new notifications. Open the bell to see them.`,
      });
    }
  }, [data]);

  return null;
}
