import type { ReactNode } from "react";

export type StackPart = { label: string; value: number; text: string; color: string };

// One 100% bar split into parts, with a legend underneath carrying the numbers.
export function StackBar({ parts, legendExtra }: { parts: StackPart[]; legendExtra?: ReactNode }) {
  return (
    <>
      <div className="pm2-stack" role="img" aria-label={parts.map((p) => `${p.label} ${p.text}`).join(", ")}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.label} style={{ flex: p.value, background: p.color }} data-tip={`${p.label}: ${p.text}`} tabIndex={0} />
          ))}
      </div>
      <div className="pm2-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label} <b>{p.text}</b>
          </span>
        ))}
        {legendExtra}
      </div>
    </>
  );
}

export default StackBar;
