"use client";

// Controlled segmented period switch (e.g. 7d / 30d / 90d). URL syncing is the
// page's job. `caption` renders the comparison note, e.g. "vs previous 30".
export function PeriodPicker<V extends string>({
  options,
  value,
  onChange,
  caption,
  ariaLabel = "Period",
}: {
  options: readonly V[];
  value: V;
  onChange: (v: V) => void;
  caption?: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <span className="pm2-period">
      <span className="pm2-seg" role="group" aria-label={ariaLabel}>
        {options.map((o) => (
          <button key={o} type="button" className={o === value ? "on" : undefined} aria-pressed={o === value} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </span>
      {caption != null && <span className="pm2-cmp">{caption}</span>}
    </span>
  );
}

export default PeriodPicker;
