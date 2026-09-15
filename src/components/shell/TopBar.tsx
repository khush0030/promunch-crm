"use client";
import Image from "next/image";
import Link from "next/link";
import { Search, Bell } from "lucide-react";
import type { Hub } from "./nav";

// Phone-only top bar (hidden above 720px by CSS).
export default function TopBar({ hub, onSearch }: { hub: Hub | null; onSearch: (opener: HTMLElement) => void }) {
  return (
    <header className="pm2-topbar">
      <Link href="/dashboard" className="pm2-topbar-logo" aria-label="PROMUNCH home">
        <Image src="/pm-logo-64.png" alt="" width={22} height={22} priority />
      </Link>
      <b>{!hub || hub === "Today" ? "PROMUNCH" : hub}</b>
      <span className="ic">
        <button type="button" aria-label="Search" onClick={(e) => onSearch(e.currentTarget)}>
          <Search aria-hidden />
        </button>
        <Link href="/dashboard/attention" aria-label="Needs attention">
          <Bell aria-hidden />
        </Link>
      </span>
    </header>
  );
}
