import type { ReactNode } from "react";

// Dashed-border empty state: icon, title, copy, optional CTA.
export function EmptyState({
  icon,
  title,
  children,
  cta,
  style,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  cta?: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="pm-empty" style={style}>
      <div className="eic">{icon}</div>
      <h3>{title}</h3>
      {children != null && <p>{children}</p>}
      {cta}
    </div>
  );
}

export default EmptyState;
