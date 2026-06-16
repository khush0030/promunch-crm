"use client";
import type { ReactNode } from "react";
import { Search } from "lucide-react";

// Search input styled like the prototype `.search`.
export function SearchBar({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="pm-search">
      <Search />
      <input
        value={value}
        placeholder={placeholder}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
    </div>
  );
}

export type Chip = { key: string; label: ReactNode };

// Pill-style single-select filter chips.
export function FilterChips({
  chips,
  active,
  onSelect,
}: {
  chips: Chip[];
  active?: string;
  onSelect?: (key: string) => void;
}) {
  return (
    <div className="pm-chips">
      {chips.map((c) => (
        <span
          key={c.key}
          className={`pm-chip${active === c.key ? " on" : ""}`}
          onClick={onSelect ? () => onSelect(c.key) : undefined}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

// Toolbar row: search on the left, chips on the right.
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="pm-toolbar">{children}</div>;
}
