import type { ReactNode } from "react";

export type HealthStatus = "ok" | "warn" | "off";

// Dot + name + status pill — channel/connection health rows.
export function HealthPill({
  name,
  status,
  statusLabel,
}: {
  name: ReactNode;
  status: HealthStatus;
  statusLabel: ReactNode;
}) {
  const stClass = status === "off" ? "off" : status;
  return (
    <div className="pm-pill">
      <span className={`d ${status}`} />
      <span className="nm">{name}</span>
      <span className={`st ${stClass}`}>{statusLabel}</span>
    </div>
  );
}

export default HealthPill;
