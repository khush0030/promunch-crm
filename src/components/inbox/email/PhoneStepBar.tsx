"use client";

// Phone-only stepper for Inbox › Email drafts: "{i} of {n}", who it's from,
// and Prev / Next. The page mounts it only when useMediaPhone() is true.
export function PhoneStepBar({
  inList,
  index,
  total,
  who,
  prevId,
  nextId,
  onGo,
}: {
  inList: boolean;
  index: number;
  total: number;
  who: string;
  prevId: string | null;
  nextId: string | null;
  onGo: (id: string) => void;
}) {
  return (
    <div className="pm2-drafts-step">
      <b>{inList ? `${index + 1} of ${total}` : "Not in this list"}</b>
      <span className="who">{who}</span>
      <span className="nav">
        {prevId ? (
          <button type="button" className="pm2-btn ghost sm" onClick={() => onGo(prevId)}>
            ← Prev
          </button>
        ) : null}
        {nextId ? (
          <button type="button" className="pm2-btn ghost sm" onClick={() => onGo(nextId)}>
            Next →
          </button>
        ) : null}
      </span>
    </div>
  );
}

export default PhoneStepBar;
