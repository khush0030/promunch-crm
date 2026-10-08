"use client";
import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { findActive, parseHref, sectionTabs } from "./nav";
import { useAccess } from "./useAccess";
import { useHash } from "./useShellData";

// Section tabs under a page title: the other pages of the same place
// (Insights: Sales · Web store · Amazon). Rendered by the page headers, so a
// page folded into one sidebar entry is always one tap away. Nothing renders
// for places with a single page.
export function SectionTabs() {
  return (
    <Suspense fallback={null}>
      <Tabs />
    </Suspense>
  );
}

function Tabs() {
  const pathname = usePathname() || "/dashboard";
  const tab = useSearchParams().get("tab");
  const hash = useHash();
  const access = useAccess();
  const active = findActive(pathname, tab, hash);
  const pages = sectionTabs(active, access);
  if (pages.length < 2) return null;
  return (
    <nav className="pm3-sectabs" aria-label={`${active?.item.label ?? ""} sections`}>
      {pages.map((pg) => {
        const on = active?.page?.href === pg.href || (!active?.page && parseHref(pg.href).path === pathname);
        return (
          <Link
            key={pg.href}
            href={pg.href}
            className={on ? "on" : undefined}
            aria-current={on ? "page" : undefined}
            onClick={(e) => {
              // Same page, other #section (Settings): set the hash so the page
              // hears a hashchange; Next's pushState alone would not tell it.
              const { path, hash } = parseHref(pg.href);
              if (hash && path === pathname) {
                e.preventDefault();
                window.location.assign(`#${hash.replace(/^#/, "")}`);
              }
            }}
          >
            {pg.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default SectionTabs;
