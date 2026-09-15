"use client";
import { Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import TabBar from "./TabBar";
import CommandPalette from "./CommandPalette";
import { findActive } from "./nav";
import { useAttentionCounts, useHash, useShellUser } from "./useShellData";

// Dashboard chrome: sidebar (desktop), top bar + tab bar (phone), ⌘K palette.
// Both layouts are always in the DOM; CSS media queries pick one.
export default function Shell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  const openPalette = useCallback((from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement as HTMLElement | null);
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    const el = opener.current;
    opener.current = null;
    // Return focus after the dialog unmounts.
    requestAnimationFrame(() => el?.focus?.());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, openPalette, closePalette]);

  return (
    <div className="pm2-app">
      {/* useSearchParams needs a Suspense boundary; the fallback renders the
          same chrome without the ?tab= so prerendered HTML has no gap. */}
      <Suspense fallback={<Chrome tab={null} onSearch={openPalette} />}>
        <ChromeWithTab onSearch={openPalette} />
      </Suspense>
      <main className="pm2-main">{children}</main>
      {paletteOpen && <CommandPalette onClose={closePalette} />}
    </div>
  );
}

function ChromeWithTab({ onSearch }: { onSearch: (from?: HTMLElement | null) => void }) {
  const tab = useSearchParams().get("tab");
  return <Chrome tab={tab} onSearch={onSearch} />;
}

function Chrome({ tab, onSearch }: { tab: string | null; onSearch: (from?: HTMLElement | null) => void }) {
  const pathname = usePathname() || "/dashboard";
  // Next's router does not fire hashchange; a nav click forces a re-read.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const onNavigate = useCallback(() => setTimeout(bump, 50), []);
  const hash = useHash();
  const active = findActive(pathname, tab, hash);
  const counts = useAttentionCounts();
  const { user, signingOut, signOut } = useShellUser();

  return (
    <>
      <Sidebar
        active={active}
        locationKey={`${pathname}?${tab ?? ""}${hash}`}
        counts={counts}
        user={user}
        signingOut={signingOut}
        onSignOut={signOut}
        onSearch={onSearch}
        onNavigate={onNavigate}
      />
      <TopBar hub={active?.hub ?? null} onSearch={onSearch} />
      <TabBar active={active} counts={counts} onNavigate={onNavigate} />
    </>
  );
}
