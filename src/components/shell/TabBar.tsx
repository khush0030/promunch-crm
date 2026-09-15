"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Sparkles, X } from "lucide-react";
import { NAV, hubHref, type ActiveNav, type AttentionCounts, type Hub } from "./nav";
import { Badge } from "./Sidebar";

const TABS: Hub[] = ["Today", "Sales", "Inbox", "Marketing"];
const MORE_HUBS: Hub[] = ["Partners", "System"];

type Props = { active: ActiveNav | null; counts: AttentionCounts | null; onNavigate: () => void };

// Phone-only bottom tab bar (hidden above 720px by CSS) + the More sheet.
export default function TabBar({ active, counts, onNavigate }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const activeHub = active?.hub ?? "Today";
  const moreOn = MORE_HUBS.includes(activeHub);

  const badgeFor = (hub: Hub) => (hub === "Today" ? counts?.open : hub === "Inbox" ? counts?.inbox : undefined);

  return (
    <>
      <nav className="pm2-tabbar" aria-label="Hubs">
        {TABS.map((hub) => {
          const h = NAV.find((x) => x.hub === hub)!;
          const Icon = h.icon;
          const on = hub === activeHub;
          return (
            <Link key={hub} href={hubHref(hub)} className={on ? "on" : undefined} aria-current={on ? "page" : undefined} onClick={onNavigate}>
              <span className="ico">
                <Icon aria-hidden />
                <Badge n={badgeFor(hub)} />
              </span>
              {hub}
            </Link>
          );
        })}
        <button
          ref={moreBtn}
          type="button"
          className={moreOn ? "on" : undefined}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <span className="ico">
            <MoreHorizontal aria-hidden />
          </span>
          More
        </button>
      </nav>
      {moreOpen && (
        <MoreSheet
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

function MoreSheet({ active, onClose, onNavigate }: { active: ActiveNav | null; onClose: () => void; onNavigate: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>(".pm2-sheet-item")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const today = NAV.find((h) => h.hub === "Today")!;
  const maya = today.items.find((it) => it.href === "/dashboard/assistant")!;

  return (
    <div className="pm2-sheet-backdrop" onClick={onClose}>
      <div
        ref={sheet}
        className="pm2-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="More"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm2-sheet-head">
          <b>More</b>
          <button type="button" className="pm2-icbtn" aria-label="Close" onClick={onClose}>
            <X aria-hidden />
          </button>
        </div>
        {NAV.filter((h) => MORE_HUBS.includes(h.hub)).map((h) => {
          const Icon = h.icon;
          return (
            <section key={h.hub} style={{ "--hc": h.color } as React.CSSProperties}>
              <h6>
                <i aria-hidden />
                {h.hub}
              </h6>
              {h.items.map((it) => (
                <Link
                  key={it.label}
                  href={it.href}
                  className={`pm2-sheet-item${active?.item === it ? " on" : ""}`}
                  onClick={onNavigate}
                >
                  <Icon aria-hidden />
                  {it.label}
                </Link>
              ))}
            </section>
          );
        })}
        <section>
          <Link href={maya.href} className={`pm2-sheet-item${active?.item === maya ? " on" : ""}`} onClick={onNavigate}>
            <Sparkles aria-hidden />
            {maya.label}
          </Link>
        </section>
      </div>
    </div>
  );
}
