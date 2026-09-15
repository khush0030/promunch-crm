import type { ReactNode } from "react";

export type FunnelStep = { label: string; value: number; text: ReactNode; color?: string; tip?: string };

// Stepped funnel. Widths are relative to the first step; each later step shows
// its conversion from the step before.
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const first = steps[0]?.value ?? 0;
  return (
    <div className="pm2-funnel">
      {steps.map((s, i) => {
        const pct = first > 0 ? Math.max(0, Math.min(100, (s.value / first) * 100)) : 0;
        const prev = i > 0 ? steps[i - 1].value : 0;
        return (
          <div className="pm2-fn" key={`${s.label}-${i}`}>
            <span>{s.label}</span>
            <span className="bar" data-tip={s.tip || undefined}>
              <div style={{ width: `${pct}%`, background: s.color || "var(--pm-cyan)" }} />
              <span>{s.text}</span>
            </span>
            <span className="rate">
              {i > 0 && prev > 0 ? (
                <>
                  <b>{Math.round((s.value / prev) * 100)}%</b> of previous
                </>
              ) : (
                " "
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default Funnel;
