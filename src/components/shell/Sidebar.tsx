"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Search, LogOut, HelpCircle } from "lucide-react";
import { NAV, type ActiveNav, type AttentionCounts, type Hub } from "./nav";
import { initialsOf, type ShellUser } from "./useShellData";

type Props = {
  active: ActiveNav | null;
  // Changes on every navigation; resets a manually opened hub.
  locationKey: string;
  counts: AttentionCounts | null;
  user: ShellUser | null;
  signingOut: boolean;
  onSignOut: () => void;
  onSearch: (opener: HTMLElement) => void;
  onNavigate: () => void;
};

export function Badge({ n, className = "bd" }: { n: number | undefined; className?: string }) {
  if (!n) return null;
  return <span className={className}>{n > 99 ? "99+" : n}</span>;
}

// Desktop sidebar (hidden at <=720px by CSS). One hub open at a time: the
// active hub by default, or whichever collapsed hub the user clicked since
// the last navigation.
export default function Sidebar({ active, locationKey, counts, user, signingOut, onSignOut, onSearch, onNavigate }: Props) {
  const [picked, setPicked] = useState<{ key: string; hub: Hub } | null>(null);
  const openHub: Hub = picked?.key === locationKey ? picked.hub : active?.hub ?? "Today";

  return (
    <aside className="pm2-side" aria-label="Main navigation">
      <Link href="/dashboard" className="pm2-logo" onClick={onNavigate}>
        <Image src="/pm-logo-64.png" alt="" width={24} height={24} priority />
        <b>PROMUNCH</b>
      </Link>
      <button type="button" className="pm2-search" onClick={(e) => onSearch(e.currentTarget)}>
        <Search aria-hidden />
        <span>Search or jump to</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="pm2-hubs">
        {NAV.map((h) => {
          const open = h.hub === openHub;
          const Icon = h.icon;
          const style = { "--hc": h.color, "--hc2": h.accent ?? h.color } as React.CSSProperties;
          return (
            <div key={h.hub} style={style}>
              <button
                type="button"
                className={`pm2-grp${open ? " open" : ""}`}
                aria-expanded={open}
                onClick={() => setPicked({ key: locationKey, hub: h.hub })}
              >
                <i aria-hidden />
                {h.hub}
                {!open && <span className="n">{h.items.length}</span>}
                {/* Tour anchors: while a hub is collapsed its items are not
                    rendered, so the onboarding spotlight lands on this row. */}
                {!open &&
                  h.items.filter((it) => it.tour).map((it) => (
                    <span key={it.tour} data-tour={it.tour} className="pm2-tour-anchor" aria-hidden />
                  ))}
              </button>
              {open && (
                <ul className="pm2-items">
                  {h.items.map((it) => {
                    const on = active?.item === it;
                    return (
                      <li key={it.label}>
                        <Link
                          href={it.href}
                          className={`pm2-item${on ? " on" : ""}`}
                          aria-current={on ? "page" : undefined}
                          data-tour={it.tour}
                          onClick={onNavigate}
                        >
                          <Icon aria-hidden />
                          <span className="lb">{it.label}</span>
                          <Badge n={it.badge ? counts?.[it.badge] : undefined} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="pm2-me">
        <span className="pm2-av" aria-hidden>{initialsOf(user)}</span>
        <span className="who">
          <span className="nm">{user?.name || "Signed out"}</span>
          <span className="rl">{user?.role || ""}</span>
        </span>
        <button
          type="button"
          className="pm2-icbtn"
          aria-label="Replay the tour"
          title="Help and tour"
          onClick={() => window.dispatchEvent(new Event("pm:start-tour"))}
        >
          <HelpCircle aria-hidden />
        </button>
        {user && (
          <button
            type="button"
            className="pm2-icbtn"
            aria-label="Sign out"
            title="Sign out"
            disabled={signingOut}
            onClick={onSignOut}
          >
            <LogOut aria-hidden />
          </button>
        )}
      </div>
    </aside>
  );
}
