"use client";

// Phone-only action bar for Inbox › Email drafts, fixed above the tab bar.
// Rewrite lives inside the Edit sheet on phone. `showApprove` is false when
// the thread isn't approvable or the sender can't receive a reply.
export function PhoneActionBar({
  busy,
  showApprove,
  canApprove,
  onApprove,
  onEdit,
  onSkip,
}: {
  busy: boolean;
  showApprove: boolean;
  canApprove: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="pm2-drafts-bar">
      {showApprove ? (
        <button type="button" className="pm2-btn pri" disabled={busy || !canApprove} onClick={onApprove}>
          Approve &amp; send
        </button>
      ) : null}
      <button type="button" className="pm2-btn" disabled={busy} onClick={onEdit}>
        Edit
      </button>
      <button type="button" className="pm2-btn ghost" disabled={busy} onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}

export default PhoneActionBar;
