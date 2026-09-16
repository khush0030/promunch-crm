"use client";

import type { ReactNode } from "react";
import { Avatar, type Channel } from "./Avatar";

// One row in the inbox conversation list / email drafts list. Renders as a
// link when `href` is given (navigable, works without JS), otherwise a
// clickable div driven by `onClick` (e.g. selecting a row inline).
export function ListRow({
  name,
  pill,
  preview,
  when,
  unread,
  channel,
  selected,
  href,
  onClick,
}: {
  name: string;
  pill?: ReactNode;
  preview: string;
  when: string;
  unread?: number;
  channel?: Channel;
  selected?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = `pm2-list-row${selected ? " sel" : ""}`;
  const content = (
    <>
      <Avatar name={name} channel={channel} size={34} />
      <div className="t">
        <span>{name}</span>
        {pill}
      </div>
      <div className="s">{preview}</div>
      <div className="r">
        <span className="when">{when}</span>
        {unread ? <span className="badge">{unread}</span> : null}
      </div>
    </>
  );

  if (href) {
    return (
      <a className={className} href={href} onClick={onClick} aria-current={selected ? "true" : undefined}>
        {content}
      </a>
    );
  }

  return (
    <div
      className={className}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {content}
    </div>
  );
}

export default ListRow;
