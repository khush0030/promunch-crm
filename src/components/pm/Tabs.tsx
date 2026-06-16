import type { ReactNode } from "react";

export type Tab = { key: string; label: ReactNode };

// Underline tab strip. Controlled via `active` + `onSelect`.
export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: Tab[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="pm-tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`pm-tab${active === t.key ? " on" : ""}`}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default Tabs;
