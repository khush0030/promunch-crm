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

// One message of the Gmail thread, reduced to what the "already answered in
// Gmail" check needs.
export type GuardThreadMessage = {
  gmailMessageId: string;
  fromEmail: string;
  internalDateMs: number;
  labelIds?: string[];
};

// True when our mailbox sent a message in this Gmail thread AFTER the inbound
// message this thread row is about, i.e. someone already answered the customer
// straight from Gmail. The anchor is the inbound message (gmail_message_id);
// if Gmail no longer lists it, the latest message not from the mailbox is used.
// Unsaved Gmail drafts (DRAFT label) are not replies and never count. With no
// anchor at all, any mailbox message counts (when in doubt, do not send).
export function mailboxRepliedAfter(
  messages: GuardThreadMessage[],
  mailbox: string,
  inboundGmailMessageId: string | null | undefined,
): boolean {
  const me = mailbox.trim().toLowerCase();
  const isMine = (m: GuardThreadMessage) => m.fromEmail.trim().toLowerCase() === me;
  const isDraft = (m: GuardThreadMessage) => (m.labelIds ?? []).includes("DRAFT");
  const real = messages.filter((m) => !isDraft(m));

  let anchorIdx = inboundGmailMessageId
    ? real.findIndex((m) => m.gmailMessageId === inboundGmailMessageId)
    : -1;
  if (anchorIdx < 0) {
    for (let i = real.length - 1; i >= 0; i--) {
      if (!isMine(real[i])) {
        anchorIdx = i;
        break;
      }
    }
  }
  if (anchorIdx < 0) return real.some(isMine);

  const anchor = real[anchorIdx];
  return real.some((m, i) =>
    isMine(m) && m.gmailMessageId !== anchor.gmailMessageId &&
    (m.internalDateMs > anchor.internalDateMs || (i > anchorIdx && m.internalDateMs >= anchor.internalDateMs))
  );
}
