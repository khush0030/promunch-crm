import type { ReactNode } from "react";

// Raised card with an optional title row (icon + heading + "more" slot) and caption.
export function Panel({
  title,
  icon,
  caption,
  more,
  children,
  style,
  className,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  caption?: ReactNode;
  more?: ReactNode;
  children?: ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div className={`pm-panel${className ? " " + className : ""}`} style={style}>
      {(title != null || more != null) && (
        <div className="pm-phead">
          <h3>
            {icon}
            {title}
          </h3>
          {more != null && <span className="more">{more}</span>}
        </div>
      )}
      {caption != null && <div className="pm-csub">{caption}</div>}
      {children}
    </div>
  );
}

export default Panel;
