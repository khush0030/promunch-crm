export type ChipItem = { key: string; label: string; count?: number };

// Single-select filter chips, e.g. Inbox's "Needs a human / Mine / Bot / All".
export function Chips({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: ChipItem[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="pm2-chips" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`pm2-chip${item.key === value ? " on" : ""}`}
          aria-pressed={item.key === value}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count != null ? <em>{item.count}</em> : null}
        </button>
      ))}
    </div>
  );
}

export default Chips;
