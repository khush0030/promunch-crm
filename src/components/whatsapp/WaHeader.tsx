"use client";

// Per-tab page header for WhatsApp marketing (04-ia.md): eyebrow, UPPERCASE
// title, one sentence, one action, then the tabs. Each tab renders its own
// <WaHeader> so the sentence can use the numbers that tab already has; the
// page owns the tab row and the slot above the body, and the header is
// portalled into that slot.

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { PageHeader, type PageHeaderTab } from "@/components/pm";
import m from "./WaHeader.module.css";

export type WaHeaderSlot = {
  el: HTMLElement | null;
  tabs: PageHeaderTab[];
  activeTab: string;
  onTab: (key: string) => void;
};

export const WaHeaderContext = createContext<WaHeaderSlot | null>(null);

export function WaHeader({ title, summary, actions }: { title: ReactNode; summary?: ReactNode; actions?: ReactNode }) {
  const slot = useContext(WaHeaderContext);
  if (!slot?.el) return null;
  return createPortal(
    <PageHeader
      crumb="Marketing · WhatsApp"
      title={title}
      summary={summary}
      actions={actions}
      tabs={slot.tabs}
      activeTab={slot.activeTab}
      onTab={slot.onTab}
    />,
    slot.el,
  );
}

// Secondary header actions live behind one "⋯" button (04-ia.md: one primary
// action; anything else in a menu). Items are ordinary buttons/links.
export function WaMoreMenu({ label = "More actions", children }: { label?: string; children: ReactNode }) {
  return (
    <details className={m.more}>
      <summary className="pm2-btn" aria-label={label} title={label}>
        <MoreHorizontal size={16} aria-hidden />
      </summary>
      <div className={m.menu} role="menu" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
        {children}
      </div>
    </details>
  );
}
