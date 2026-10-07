"use client";
import Image from "next/image";
import Link from "next/link";
import { LogOut, HelpCircle, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { MAYA, SETTINGS, itemFor, navFor, samePlace, type ActiveNav, type AttentionCounts, type NavItem } from "./nav";
import { useAccess } from "./useAccess";
import { initialsOf, type ShellUser } from "./useShellData";

type Props = {
  active: ActiveNav | null;
  counts: AttentionCounts | null;
  user: ShellUser | null;
  signingOut: boolean;
  onSignOut: () => void;
  onNavigate: () => void;
  rail: boolean;
  onToggleRail: () => void;
};

export function Badge({ n, className = "bd" }: { n: number | undefined; className?: string }) {
  if (!n) return null;
  return <span className={className}>{n > 99 ? "99+" : n}</span>;
}

// Extra onboarding anchors when one place stands for several tour steps
// (Inbox = conversations + email drafts). The first tour sits on the link.
function TourAnchors({ tours }: { tours?: string[] }) {
  return (
    <>
      {tours?.slice(1).map((t) => (
        <span key={t} data-tour={t} className="pm2-tour-anchor" aria-hidden />
      ))}
    </>
  );
}

// Laptop sidebar (hidden at <=760px by CSS): Ask Maya pinned, then three
// groups, Settings + collapse + the signed-in person in the footer.
export default function Sidebar({ active, counts, user, signingOut, onSignOut, onNavigate, rail, onToggleRail }: Props) {
  const access = useAccess();
  const nav = navFor(access);
  const maya = itemFor(access, MAYA);
  const settings = itemFor(access, SETTINGS);
  const isOn = (it: NavItem) => samePlace(active?.item, it) || (!!it.children && it.children.some((c) => samePlace(active?.item, c)));

  const link = (it: NavItem, sub = false) => {
    const on = isOn(it);
    const Icon = it.icon;
    return (
      <Link
        href={it.href}
        className={`pm3-nav${sub ? " sub" : ""}${on ? " on" : ""}`}
        aria-current={on && !it.children ? "page" : undefined}
        data-tour={it.tours?.[0]}
        title={rail ? it.label : undefined}
        onClick={onNavigate}
      >
        {sub ? <i className="dot" aria-hidden /> : <Icon aria-hidden />}
        <span className="lb">{it.label}</span>
        <Badge n={it.badge ? counts?.[it.badge] : undefined} />
        <TourAnchors tours={it.tours} />
      </Link>
    );
  };

  return (
    <aside className="pm3-side" aria-label="Main navigation">
      <Link href="/dashboard" className="pm3-brand" onClick={onNavigate} aria-label="PROMUNCH CRM home">
        <Image src="/promunch-wordmark.png" alt="PROMUNCH" width={120} height={29} priority />
        <span>CRM</span>
      </Link>

      {maya && (
        <Link href={maya.href} className={`pm3-maya${isOn(maya) ? " on" : ""}`} title={rail ? "Ask Maya (⌘J)" : undefined} onClick={onNavigate}>
          <maya.icon aria-hidden />
          <span className="lb">Ask Maya</span>
          <kbd>⌘J</kbd>
        </Link>
      )}

      <nav className="pm3-navs">
        {nav.map((s) => (
          <div key={s.title ?? "main"} className="pm3-sec">
            {s.title && <div className="pm3-sec-t">{s.title}</div>}
            {s.items.map((it) => {
              // Marketing opens to WhatsApp / Email while you are inside it;
              // closed, it carries their tour anchors instead.
              const open = !!it.children && isOn(it) && !rail;
              const shown = open || !it.children ? it : { ...it, tours: it.children.flatMap((c) => c.tours ?? []) };
              return (
                <div key={it.label}>
                  {link(shown)}
                  {open && (
                    <div className="pm3-subs">
                      {it.children!.map((c) => (
                        <div key={c.label}>{link(c, true)}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="pm3-foot">
        {settings && link(settings)}
        <button type="button" className="pm3-nav" onClick={onToggleRail} aria-pressed={rail} title={rail ? "Expand" : undefined}>
          {rail ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          <span className="lb">Collapse</span>
        </button>
        <div className="pm3-me">
          <span className="pm3-av" aria-hidden>
            {initialsOf(user)}
          </span>
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
            <button type="button" className="pm2-icbtn" aria-label="Sign out" title="Sign out" disabled={signingOut} onClick={onSignOut}>
              <LogOut aria-hidden />
            </button>
          )}
        </div>
        <div className="pm3-tagline">★ Your Munchy Pal</div>
      </div>
    </aside>
  );
}
