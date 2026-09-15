import type { ReactNode } from "react";

// pm v2 panel: heading (weight 650), optional mono "basis" caption saying what
// the numbers are based on, a right slot, and an optional footer row.
// `flush` drops the body side/bottom padding for edge-to-edge lists/tables.
export function Card({
  title,
  basis,
  right,
  foot,
  flush = false,
  className,
  children,
}: {
  title?: ReactNode;
  basis?: ReactNode;
  right?: ReactNode;
  foot?: ReactNode;
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`pm2-panel${className ? " " + className : ""}`}>
      {(title != null || basis != null || right != null) && (
        <div className="pm2-p-head">
          {title != null && <h3>{title}</h3>}
          {basis != null && <span className="basis">{basis}</span>}
          {right != null && <span className="r">{right}</span>}
        </div>
      )}
      <div className={`pm2-p-body${flush ? " flush" : ""}`}>{children}</div>
      {foot != null && <div className="pm2-p-foot">{foot}</div>}
    </section>
  );
}

export default Card;
