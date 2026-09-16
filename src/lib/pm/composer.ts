// Pure send-eligibility rule for the pm Composer, shared by the Send button
// and the ⌘/Ctrl+Enter keyboard shortcut so the two paths can never disagree.
// `disabledReason` (e.g. "24-hour window closed, send a template") blocks
// sending outright — the composer's text box is not the way out of that
// state, the `actions` slot (Template, etc.) is.
export function canSend({
  busy,
  value,
  disabledReason,
}: {
  busy: boolean;
  value: string;
  disabledReason?: string;
}): boolean {
  if (busy) return false;
  if (disabledReason) return false;
  return value.trim().length > 0;
}
