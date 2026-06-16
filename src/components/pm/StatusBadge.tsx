import type { ReactNode } from "react";

export type BadgeTone = "green" | "gold" | "terra" | "gray" | "blue";

// Soft-fill status pill. green=good, gold=pending/warn, terra=danger/failed,
// gray=neutral/not-eligible, blue=info.
export function StatusBadge({
  tone,
  children,
  icon,
  style,
}: {
  tone: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span className={`pm-badge2 bg-${tone}`} style={style}>
      {icon}
      {children}
    </span>
  );
}

export default StatusBadge;
