"use client";
import { useToast } from "@/components/ui/Toast";
import { getSound, playPing, SOUNDS } from "@/components/whatsapp/InboxNotifier";
import {
  requestPopupPermission,
  useNotificationActions,
  useNotificationFeed,
  usePopupPermission,
} from "@/components/shell/notifications/useNotifications";
import { useHydrated } from "@/components/shell/useShellData";
import type { NotifPrefs } from "@/lib/notifications/state";
import css from "./Settings.module.css";
import n from "./NotificationPrefs.module.css";

// Settings → My profile → Notifications. Saved per person in their own
// user_metadata (PATCH /api/me/notifications), so they follow the user to
// every browser. Changes save on click.
export function NotificationPrefs() {
  const toast = useToast();
  const feed = useNotificationFeed();
  const { savePrefs } = useNotificationActions();
  const perm = usePopupPermission();
  // Gate on hydration so the first client render matches the server HTML.
  const hydrated = useHydrated();
  const data = hydrated ? feed.data : undefined;
  const isError = hydrated && feed.isError;

  if (!data) {
    return (
      <div className={css.card}>
        <div className={css.empty}>{isError ? "Couldn't load notification settings. Refresh to try again." : "Loading notification settings…"}</div>
      </div>
    );
  }
  const prefs = data.prefs;
  const soundName = SOUNDS.find((s) => s.id === getSound())?.label ?? "Chime";

  async function set(patch: Partial<NotifPrefs>) {
    try {
      await savePrefs(patch);
    } catch (e) {
      toast.push({ kind: "error", text: `Couldn't save: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }

  async function allowPopups() {
    const p = await requestPopupPermission();
    if (p === "granted") {
      if (!prefs.popups) set({ popups: true });
      toast.push({ kind: "success", text: "Pop-ups allowed in this browser." });
    }
  }

  const permText =
    perm === "granted"
      ? "Allowed in this browser."
      : perm === "denied"
        ? "Blocked in this browser. Allow notifications for this site from the address bar, then reload."
        : perm === "unsupported"
          ? "This browser doesn't support pop-ups."
          : "Not allowed yet in this browser.";

  return (
    <div className={css.card}>
      <div className={css.profTop}>
        <div className={css.tx}>
          <b>Notifications</b>
          <span>The bell at the top shows what needs you and anything that needs fixing.</span>
        </div>
      </div>

      <div className={css.profRow}>
        <span className={css.lab}>Sound</span>
        <div className={css.profBody}>
          <div className={n.line}>
            <Toggle on={prefs.sound} label="Play a sound for new notifications" onChange={(v) => set({ sound: v })} />
            <span>{prefs.sound ? "On" : "Off"}</span>
            <button type="button" className={css.link} onClick={() => playPing()}>
              Play test sound
            </button>
          </div>
          <span className={css.hintTx}>
            A short {soundName.toLowerCase()} once per burst of new items. Off here also silences live chat pings in the Inbox.
          </span>
        </div>
      </div>

      <div className={css.profRow}>
        <span className={css.lab}>Pop-ups</span>
        <div className={css.profBody}>
          <div className={n.line}>
            <Toggle on={prefs.popups} label="Show browser pop-ups" onChange={(v) => set({ popups: v })} />
            <span>{prefs.popups ? "On" : "Off"}</span>
            {perm === "default" && (
              <button type="button" className="pm2-btn" onClick={allowPopups}>
                Allow pop-ups
              </button>
            )}
          </div>
          <span className={css.hintTx}>Shown when the CRM is open in a background tab. {permText}</span>
        </div>
      </div>

      <div className={css.profRow}>
        <span className={css.lab}>Alert me for</span>
        <div className={css.profBody}>
          <label className={n.check}>
            <input type="checkbox" checked={prefs.needs_you} onChange={(e) => set({ needs_you: e.target.checked })} />
            <span>
              <b>Needs you</b>
              COD calls, chats and tickets, B2B replies, creator drafts, email drafts
            </span>
          </label>
          <label className={n.check}>
            <input type="checkbox" checked={prefs.issues} onChange={(e) => set({ issues: e.target.checked })} />
            <span>
              <b>Issues to fix</b>
              Sync or send failures, failed campaigns, templates rejected by Meta
            </span>
          </label>
          <span className={css.hintTx}>
            Unticked groups still show in the bell, just without a sound or pop-up. Live chat alerts also have their own on/off switch on the Inbox chats page.
          </span>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={n.switch} onClick={() => onChange(!on)} />;
}
