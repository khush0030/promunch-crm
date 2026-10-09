"use client";
import Image from "next/image";
import Link from "next/link";
import { Search } from "lucide-react";
import NotificationCenter from "./notifications/NotificationCenter";

// Top bar over the page: one wide search (⌘K) and the notification bell. On
// phones it also carries the logo, and search shrinks to an icon. `alerts`
// (the attention count) is only the bell's fallback dot if its feed fails.
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
      <NotificationCenter fallbackAlerts={alerts} />
    </header>
  );
}
