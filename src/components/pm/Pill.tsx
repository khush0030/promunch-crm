import type { ReactNode } from "react";

export type PillTone = "good" | "warn" | "crit" | "info" | "neu" | "brand";

// Status pill. The leading shape carries meaning without colour:
// good/info/brand/neu = dot, warn = triangle, crit = diamond. `plain` hides it.
export function Pill({
  tone,
  plain = false,
  tip,
  children,
}: {
  tone: PillTone;
  plain?: boolean;
  tip?: string;
  children: ReactNode;
}) {
  return (
    <span className={`pm2-pill ${tone}${plain ? " plain" : ""}`} data-tip={tip || undefined}>
      {children}
    </span>
  );
}

export default Pill;
