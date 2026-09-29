"use client";
import Link from "next/link";
import { Check, ChevronDown, X } from "lucide-react";
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import s from "./guide.module.css";

export type GuideAction = { label: string; href?: string; onClick?: () => void };

export type GuideChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  help?: ReactNode;
  cta?: GuideAction;
};

// ---- dismissal persisted per checklist id (localStorage, never throws) ----
const PREFIX = "pm-guide-dismissed:";
const EVENT = "pm-guide-dismissed";

function readDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(PREFIX + id) === "1";
  } catch {
    return false;
  }
}
function writeDismissed(id: string, v: boolean) {
  try {
    if (v) window.localStorage.setItem(PREFIX + id, "1");
    else window.localStorage.removeItem(PREFIX + id);
  } catch {
    /* storage blocked: dismissal lasts until reload */
  }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** Renders a GuideAction as a next/link (href) or a button (onClick). */
export function ActionButton({ action, primary }: { action: GuideAction; primary?: boolean }) {
  const cls = `pm2-btn sm${primary ? " pri" : ""}`;
  if (action.href) {
    return (
      <Link className={cls} href={action.href} onClick={action.onClick}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={action.onClick}>
      {action.label}
    </button>
  );
}

/**
 * Setup checklist card: "2 of 4 done" progress, the first unfinished item is
 * expanded with its help text and CTA, others expand on click.
 * With `dismissible`, a close button hides it for good (per `id`, localStorage).
 */
export function GuideChecklist({
  id,
  title,
  subtitle,
  items,
  dismissible = false,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  items: GuideChecklistItem[];
  dismissible?: boolean;
}) {
  const uid = useId();
  const dismissed = useSyncExternalStore(
    subscribe,
    () => (dismissible ? readDismissed(id) : false),
    () => false,
  );
  const [openKey, setOpenKey] = useState<string | null | undefined>(undefined);
  // Local fallback so the close button works even when storage is blocked.
  const [hidden, setHidden] = useState(false);

  if (dismissed || hidden) return null;

  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = total > 0 && doneCount === total;
  const firstUndone = items.find((i) => !i.done)?.key ?? null;
  const expanded = openKey === undefined ? firstUndone : openKey;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <section className={s.checklist} aria-labelledby={`${uid}-t`}>
      <div className={s.clHead}>
        <div className={s.clHeadText}>
          <h3 id={`${uid}-t`} className={s.clTitle}>{title}</h3>
          {subtitle != null && <div className={s.clSub}>{subtitle}</div>}
        </div>
        <span className={s.clCount}>{allDone ? "All done" : `${doneCount} of ${total} done`}</span>
        {dismissible && (
          <button
            type="button"
            className={s.iconBtn}
            aria-label={`Hide "${title}"`}
            onClick={() => {
              setHidden(true);
              writeDismissed(id, true);
            }}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={s.clMeter} aria-hidden="true">
        <div style={{ width: `${pct}%` }} />
      </div>
      <ol className={s.clList}>
        {items.map((item) => {
          const isOpen = expanded === item.key;
          const hasBody = item.help != null || item.cta != null;
          const bodyId = `${uid}-${item.key}`;
          const mark = (
            <span className={`${s.clMark} ${item.done ? s.clMarkDone : ""}`} aria-hidden="true">
              {item.done && <Check />}
            </span>
          );
          const label = (
            <>
              <span className={item.done ? s.clLabelDone : s.clLabel}>{item.label}</span>
              <span className={s.srOnly}>{item.done ? " (done)" : " (to do)"}</span>
            </>
          );
          return (
            <li key={item.key} className={s.clItem}>
              {hasBody ? (
                <button
                  type="button"
                  className={s.clRow}
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => setOpenKey(isOpen ? null : item.key)}
                >
                  {mark}
                  {label}
                  <ChevronDown className={`${s.clChev} ${isOpen ? s.clChevOpen : ""}`} aria-hidden="true" />
                </button>
              ) : (
                <div className={s.clRow}>
                  {mark}
                  {label}
                </div>
              )}
              {hasBody && (
                <div id={bodyId} className={s.clBody} hidden={!isOpen}>
                  {item.help != null && <div className={s.clHelp}>{item.help}</div>}
                  {item.cta && !item.done && <ActionButton action={item.cta} primary />}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default GuideChecklist;
