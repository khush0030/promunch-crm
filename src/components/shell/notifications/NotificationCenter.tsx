"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import { useAccess } from "@/components/shell/useAccess";
import { useHydrated } from "@/components/shell/useShellData";
import { canUse, PROFILE_PATH } from "@/lib/access";
import { timeAgo } from "@/lib/notifications/state";
import { requestPopupPermission, useNotificationActions, useNotificationFeed, usePopupPermission, type FeedItem } from "./useNotifications";
import css from "./Notifications.module.css";

// Header bell + notification centre. A popover under the bell on laptops, a
// bottom drawer on phones. Two groups: "Needs you now" and "Issues to fix".
// `fallbackAlerts` (the attention count) keeps a dot on the bell if the feed
// itself can't load.
export default function NotificationCenter({ fallbackAlerts }: { fallbackAlerts: number }) {
  // Open for the page it was opened on: navigating away closes it.
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const feed = useNotificationFeed();
  // Match the server HTML on first render even if the feed is already cached.
  const hydrated = useHydrated();
  const data = hydrated ? feed.data : undefined;
  const isError = hydrated && feed.isError;
  const unread = data?.unread ?? 0;
  const btn = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback((refocus = true) => {
    setOpenOn(null);
    if (refocus) requestAnimationFrame(() => btn.current?.focus());
  }, []);

  const label = unread ? `Notifications, ${unread} unread` : "Notifications";
  const showDot = hydrated && !data && (isError || fallbackAlerts > 0);

  return (
    <div className={css.wrap}>
      <button
        ref={btn}
        type="button"
        className="pm3-bell"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => (open ? close(false) : setOpenOn(pathname))}
      >
        <Bell aria-hidden />
        {unread > 0 && (
          <span className={css.count} aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        {showDot && <i aria-hidden />}
      </button>
      {open && <Panel id={panelId} onClose={close} anchor={btn} />}
    </div>
  );
}

function Panel({ id, onClose, anchor }: { id: string; onClose: (refocus?: boolean) => void; anchor: React.RefObject<HTMLButtonElement | null> }) {
  const { data, isLoading, isError } = useNotificationFeed();
  const { markAllRead, markRead, dismiss } = useNotificationActions();
  const access = useAccess();
  const ref = useRef<HTMLDivElement>(null);
  const perm = usePopupPermission();
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const now = new Date();

  // Portalled to <body> so it sits above the sticky header and the phone tab
  // bar; on laptops it is pinned under the bell.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose, anchor]);

  const items = data?.items ?? [];
  const needs = items.filter((i) => i.category === "needs_you");
  const issues = items.filter((i) => i.category === "issues");
  const unread = data?.unread ?? 0;
  const settingsHref = access && canUse(access, "system") ? "/dashboard/settings#profile" : PROFILE_PATH;

  const allowPopups = () => void requestPopupPermission();

  return createPortal(
    <>
      <div className={css.scrim} aria-hidden onClick={() => onClose(false)} />
      <div
        ref={ref}
        id={id}
        role="dialog"
        aria-label="Notifications"
        tabIndex={-1}
        className={css.panel}
        style={pos ? ({ "--nc-top": `${pos.top}px`, "--nc-right": `${pos.right}px` } as React.CSSProperties) : undefined}
      >
        <div className={css.grab} aria-hidden />
        <header className={css.head}>
          <div>
            <h2>Notifications</h2>
            <p>{unread ? `${unread} unread` : "You're all caught up"}</p>
          </div>
          <button type="button" className={css.textBtn} onClick={markAllRead} disabled={!unread}>
            Mark all read
          </button>
          <button type="button" className={css.close} onClick={() => onClose()} aria-label="Close notifications">
            <X aria-hidden />
          </button>
        </header>

        {perm === "default" && data?.prefs.popups && (
          <div className={css.permit}>
            <span>Get a pop-up when something new comes in while the CRM is in the background.</span>
            <button type="button" className={css.textBtn} onClick={allowPopups}>
              Allow pop-ups
            </button>
          </div>
        )}

        <div className={css.body}>
          {isLoading && !data ? (
            <p className={css.empty}>Loading…</p>
          ) : isError && !data ? (
            <p className={css.empty}>Couldn&apos;t load notifications. They&apos;ll retry in a moment.</p>
          ) : (
            <>
              <Group title="Needs you now" empty="Nothing is waiting on you." items={needs} now={now} onOpen={markRead} onHide={dismiss} onClose={onClose} />
              <Group title="Issues to fix" empty="No system problems in the last 24 hours." items={issues} now={now} onOpen={markRead} onHide={dismiss} onClose={onClose} />
            </>
          )}
        </div>

        <footer className={css.foot}>
          {access && canUse(access, "home") ? (
            <Link href="/dashboard/attention" onClick={() => onClose(false)}>
              Everything that needs you
            </Link>
          ) : (
            <span />
          )}
          <Link href={settingsHref} onClick={() => onClose(false)}>
            Notification settings
          </Link>
        </footer>
      </div>
    </>,
    document.body,
  );
}

const SEV_LABEL = { crit: "Urgent", warn: "Needs a look", info: "For your info" } as const;

function Group({
  title,
  empty,
  items,
  now,
  onOpen,
  onHide,
  onClose,
}: {
  title: string;
  empty: string;
  items: FeedItem[];
  now: Date;
  onOpen: (id: string) => void;
  onHide: (id: string) => void;
  onClose: (refocus?: boolean) => void;
}) {
  return (
    <section className={css.group} aria-label={title}>
      <h3>
        {title}
        {items.length > 0 && <span>{items.length}</span>}
      </h3>
      {items.length === 0 ? (
        <p className={css.none}>{empty}</p>
      ) : (
        <ul>
          {items.map((it) => (
            <li key={it.id} className={`${css.item} ${it.unread ? css.unread : ""}`}>
              <i className={`${css.sev} ${css[it.severity]}`} title={SEV_LABEL[it.severity]} aria-hidden />
              <Link
                href={it.href}
                className={css.link}
                onClick={() => {
                  if (it.unread) onOpen(it.id);
                  onClose(false);
                }}
              >
                <b>{it.title}</b>
                {it.body && <span className={css.sub}>{it.body}</span>}
                <span className={css.meta}>
                  <span className={css.sr}>{SEV_LABEL[it.severity]}. </span>
                  {timeAgo(it.created_at, now)}
                  {it.unread && <span className={css.sr}>. Unread</span>}
                </span>
              </Link>
              {it.unread && <span className={css.dot} aria-hidden />}
              <button type="button" className={css.hide} onClick={() => onHide(it.id)} aria-label={`Hide: ${it.title}`} title="Hide">
                <X aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
