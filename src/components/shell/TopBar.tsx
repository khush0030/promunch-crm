"use client";
import Image from "next/image";
import Link from "next/link";
import { Search, Bell } from "lucide-react";

// Top bar over the page: one wide search (⌘K) and the bell. On phones it also
// carries the logo, and search shrinks to an icon.
export default function TopBar({ onSearch, alerts }: { onSearch: (opener: HTMLElement) => void; alerts: number }) {
  return (
    <header className="pm3-top">
      <Link href="/dashboard" className="pm3-top-logo" aria-label="PROMUNCH home">
        <Image src="/promunch-wordmark.png" alt="PROMUNCH" width={100} height={24} priority />
      </Link>
      <button type="button" className="pm3-search" onClick={(e) => onSearch(e.currentTarget)} aria-label="Search">
        <Search aria-hidden />
        <span>Search orders, customers, tickets, anything</span>
        <kbd>⌘K</kbd>
      </button>
      <Link href="/dashboard/attention" className="pm3-bell" aria-label={alerts ? `${alerts} things need you` : "Needs you"}>
        <Bell aria-hidden />
        {alerts > 0 && <i aria-hidden />}
      </Link>
    </header>
  );
}
