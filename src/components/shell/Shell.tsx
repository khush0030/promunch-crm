"use client";
import { Suspense, useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import TabBar from "./TabBar";
import CommandPalette from "./CommandPalette";
import { findActive } from "./nav";
import { useAttentionCounts, useHash, useShellUser } from "./useShellData";

// Dashboard chrome: sidebar (laptop), top bar (search + bell), phone tab bar,
// ⌘K palette and ⌘J for Ask Maya.
// Both layouts are always in the DOM; CSS media queries pick one.
export default function Shell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const router = useRouter();
  const [rail, toggleRail] = useRail();
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
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
      } else if (k === "j") {
        // ⌘J: Ask Maya, from anywhere.
        e.preventDefault();
        if (paletteOpen) closePalette();
        router.push("/dashboard/assistant");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, openPalette, closePalette, router]);

  return (
    <div className={`pm2-app${rail ? " rail" : ""}`}>
      {/* useSearchParams needs a Suspense boundary; the fallback renders the
          same chrome without the ?tab= so prerendered HTML has no gap. */}
      <Suspense fallback={<Chrome tab={null} onSearch={openPalette} rail={rail} onToggleRail={toggleRail} />}>
        <ChromeWithTab onSearch={openPalette} rail={rail} onToggleRail={toggleRail} />
      </Suspense>
      <main className="pm2-main">{children}</main>
      {paletteOpen && <CommandPalette onClose={closePalette} />}
    </div>
  );
}

type ChromeProps = { onSearch: (from?: HTMLElement | null) => void; rail: boolean; onToggleRail: () => void };

function ChromeWithTab(props: ChromeProps) {
  const tab = useSearchParams().get("tab");
  return <Chrome tab={tab} {...props} />;
}

// Collapsed icon rail, remembered per browser. Tablets (761-1099px) start
// collapsed so the page keeps its width; desktops start expanded. Each size
// remembers its own choice.
const TABLET = "(max-width: 1099px)";
const railListeners = new Set<() => void>();
function isTablet(): boolean {
  return typeof window !== "undefined" && window.matchMedia(TABLET).matches;
}
function railKey(): string {
  return isTablet() ? "pm:rail-tablet" : "pm:rail";
}
function readRail(): boolean {
  try {
    const v = localStorage.getItem(railKey());
    return isTablet() ? v !== "0" : v === "1";
  } catch {
    return isTablet();
  }
}
function subscribeRail(cb: () => void) {
  railListeners.add(cb);
  const mq = window.matchMedia(TABLET);
  mq.addEventListener("change", cb);
  return () => {
    railListeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
}
function useRail(): [boolean, () => void] {
  const rail = useSyncExternalStore(subscribeRail, readRail, () => false);
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(railKey(), readRail() ? "0" : "1");
    } catch {}
    railListeners.forEach((l) => l());
  }, []);
  return [rail, toggle];
}

function Chrome({ tab, onSearch, rail, onToggleRail }: ChromeProps & { tab: string | null }) {
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
        counts={counts}
        user={user}
        signingOut={signingOut}
        onSignOut={signOut}
        onNavigate={onNavigate}
        rail={rail}
        onToggleRail={onToggleRail}
      />
      <TopBar onSearch={onSearch} alerts={counts?.open ?? 0} />
      <TabBar active={active} counts={counts} onNavigate={onNavigate} />
    </>
  );
}
