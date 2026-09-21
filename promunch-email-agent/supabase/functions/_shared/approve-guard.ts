// Pure decisions used by approve.ts around (never inside) its frozen atomic
// claim + Gmail send. Kept separate so they can be unit-tested without a DB.

// True when the approver saw a different draft revision than the one that is
// current now (someone rewrote/edited it in between). Callers that don't know
// which revision was shown (Slack today) pass nothing and are never blocked.
export function isStaleDraft(
  expectedDraftRevisionId: string | null | undefined,
  currentDraftId: string,
): boolean {
  return !!expectedDraftRevisionId && expectedDraftRevisionId !== currentDraftId;
}

// The claim UPDATE matched no row. Only a thread that really is sent or being
// sent counts as "already sent"; anything else (claim error, constraint that
// rejects 'sending', row vanished) means the send never started.
export function claimLossOutcome(
  statusAfter: string | null | undefined,
): "already_sent" | "not_started" {
  return statusAfter === "sent" || statusAfter === "sending" ? "already_sent" : "not_started";
}
