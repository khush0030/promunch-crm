import type { ReactNode } from "react";

// Colour-coded soft chip (Oct 9 owner ask: "spacious, clean, colour coded").
// One colour per MEANING across the whole app, so the same thing always
// looks the same: pass a meaning (`kind`) rather than a colour where one fits.
export type TagTone =
  | "green" // WhatsApp, solved, won, sent, good
  | "blue" // Email, info
  | "red" // needs a reply, failed, urgent, lost
  | "amber" // draft ready, waiting, pending, follow up
  | "purple" // wholesale, B2B buyer
  | "teal" // partnership, collab
  | "pink" // Instagram, creators
  | "brand" // PROMUNCH accent (use sparingly)
  | "grey"; // bot, neutral, closed, skipped

const KIND_TONE: Record<string, TagTone> = {
  whatsapp: "green",
  wa: "green",
  email: "blue",
  em: "blue",
  instagram: "pink",
  ig: "pink",
  needs_human: "red",
  needs_reply: "red",
  urgent: "red",
  failed: "red",
  lost: "red",
  draft: "amber",
  draft_ready: "amber",
  waiting: "amber",
  pending: "amber",
  follow_up: "amber",
  snoozed: "amber",
  bot: "grey",
  closed: "grey",
  skipped: "grey",
  on_hold: "grey",
  solved: "green",
  resolved: "green",
  won: "green",
  sent: "green",
  replied: "green",
  wholesale: "purple",
  b2b: "purple",
  distributor: "purple",
  partnership: "teal",
  collab: "teal",
  creator: "pink",
  support: "blue",
  order_issue: "red",
};

export function toneFor(kind: string | null | undefined, fallback: TagTone = "grey"): TagTone {
  if (!kind) return fallback;
  return KIND_TONE[kind.toLowerCase().replace(/[\s-]+/g, "_")] ?? fallback;
}

export function Tag({
  tone,
  kind,
  icon,
  dot = false,
  size = "md",
  title,
  children,
}: {
  tone?: TagTone;
  /** A meaning like "whatsapp", "needs_human", "wholesale"; picks the tone. */
  kind?: string | null;
  icon?: ReactNode;
  dot?: boolean;
  size?: "sm" | "md";
  title?: string;
  children: ReactNode;
}) {
  const t = tone ?? toneFor(kind);
  return (
    <span className={`pm-tag t-${t}${size === "sm" ? " sm" : ""}`} title={title}>
      {dot && <i aria-hidden />}
      {icon}
      {children}
    </span>
  );
}

export default Tag;
