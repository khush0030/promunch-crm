// Pure helpers for the pm Avatar component: initials + a stable colour pick
// keyed off the contact's name so the same person always renders the same
// colour across the inbox list, thread header and kanban cards.

// Ordered token list. Avatars render as a soft tint of the tone with the
// initials in the tone itself (Avatar.tsx); yellow is Maya's alone, so the
// warm slot is amber (gold), not sun.
export const AVATAR_COLOR_TOKENS = [
  "var(--pm-gold)",
  "var(--pm-cyan)",
  "var(--pm-brand)",
  "var(--pm-orange)",
  "var(--pm-green)",
  "var(--pm-s-hypd)",
  "var(--pm-muted)",
] as const;

export function avatarColorToken(name: string): (typeof AVATAR_COLOR_TOKENS)[number] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_COLOR_TOKENS.length;
  return AVATAR_COLOR_TOKENS[idx];
}

// Initials take the tone; the background is a soft tint of it (avatarTint).
export function avatarTextColor(token: string): string {
  return token;
}

export function avatarTint(token: string): string {
  return `color-mix(in srgb, ${token} 15%, var(--pm-card))`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
