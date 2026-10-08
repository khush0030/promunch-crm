"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LayoutGrid, X } from "lucide-react";
import { MAYA, SETTINGS, allItems, itemFor, navFor, samePlace, type ActiveNav, type Area, type AttentionCounts, type NavItem } from "./nav";
import { useAccess } from "./useAccess";
import { Badge } from "./Sidebar";

// Phone tabs: Home · Inbox · (Maya) · Orders · More. Everything else lives in
// the More sheet.
const TABS: Area[] = ["Home", "Inbox", "Maya", "Orders"];
const SHORT: Partial<Record<Area, string>> = { Maya: "Maya", Orders: "Orders" };

type Props = { active: ActiveNav | null; counts: AttentionCounts | null; onNavigate: () => void };

// Phone-only bottom tab bar (hidden above 760px by CSS) + the More sheet.
export default function TabBar({ active, counts, onNavigate }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const access = useAccess();
  const visible = allItems(
    navFor(access),
    [itemFor(access, MAYA), itemFor(access, SETTINGS)].filter((x): x is NavItem => !!x),
  );
  const tabs = TABS.map((a) => visible.find((it) => it.area === a)).filter((x): x is NavItem => !!x);
  const more = visible.filter((it) => !TABS.includes(it.area));
  const activeArea = active?.area ?? "Home";
  const moreOn = !TABS.includes(activeArea);

  return (
    <>
      <nav className="pm3-tabbar" aria-label="Main">
        {tabs.map((it) => {
          const on = it.area === activeArea;
          return (
            <Link
              key={it.area}
              href={it.href}
              className={`${it.area === "Maya" ? "maya" : ""}${on ? " on" : ""}`}
              aria-current={on ? "page" : undefined}
              onClick={onNavigate}
            >
              <span className="ico">
                <it.icon aria-hidden />
                <Badge n={it.badge ? counts?.[it.badge] : undefined} />
              </span>
              {SHORT[it.area] ?? it.label}
            </Link>
          );
        })}
        {more.length > 0 && (
          <button
            ref={moreBtn}
            type="button"
            className={moreOn ? "on" : undefined}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <span className="ico">
              <LayoutGrid aria-hidden />
            </span>
            More
          </button>
        )}
      </nav>
      {moreOpen && (
        <MoreSheet
          items={more}
          active={active}
          onClose={() => {
            setMoreOpen(false);
            moreBtn.current?.focus();
          }}
          onNavigate={() => {
            setMoreOpen(false);
            onNavigate();
          }}
        />
      )}
    </>
  );
}

function MoreSheet({
  items,
  active,
  onClose,
  onNavigate,
}: {
  items: NavItem[];
  active: ActiveNav | null;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    // Focus the sheet itself so no item looks pre-selected.
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pm2-sheet-backdrop" onClick={onClose}>
      <div ref={sheet} tabIndex={-1} className="pm3-sheet" role="dialog" aria-modal="true" aria-label="More" onClick={(e) => e.stopPropagation()}>
        <i className="grab" aria-hidden />
        <div className="pm3-sheet-head">
          <b>More</b>
          <button type="button" className="pm2-icbtn" aria-label="Close" onClick={onClose}>
            <X aria-hidden />
          </button>
        </div>
        {items.map((it) => (
          <Link key={it.label} href={it.href} className={`pm3-sheet-item${samePlace(active?.item, it) ? " on" : ""}`} onClick={onNavigate}>
            <span className="ic">
              <it.icon aria-hidden />
            </span>
            <span className="tx">
              <b>{it.label}</b>
              {it.desc && <span>{it.desc}</span>}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
