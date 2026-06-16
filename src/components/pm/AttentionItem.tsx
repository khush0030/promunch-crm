import type { ReactNode } from "react";

// One "Needs attention" row: icon + text (with optional sub) + action button/link.
export function AttentionItem({
  icon,
  tone = "a",
  text,
  sub,
  action,
}: {
  icon: ReactNode;
  tone?: "r" | "a";
  text: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pm-att">
      <span className={`ic2 ${tone}`}>{icon}</span>
      <span className="tx">
        {text}
        {sub != null && <small>{sub}</small>}
      </span>
      {action}
    </div>
  );
}

export default AttentionItem;
