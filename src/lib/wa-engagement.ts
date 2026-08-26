// WhatsApp audience quality — shared tier vocabulary.
//
// Every wa_contacts row carries exactly one `tier:*` tag, written by the SQL
// function recompute_wa_engagement_tags() (migration 014) from the live view
// wa_contact_engagement. The tier lives in `tags` rather than in its own column
// on purpose: the campaign sender (edge fn wa-campaign-send) resolves an
// audience ONLY through `audience_filter.tags` -> `wa_contacts.tags` overlap, so
// a tag makes engagement targetable with no change to the send path.
//
// Tag overlap is a union (OR), which is exactly what a tier ladder wants:
// ["tier:engaged","tier:reachable"] means "either", never "both".

export const TIERS = ["engaged", "reachable", "subscribed", "imported", "suppressed"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_TAGS: Record<Tier, string> = {
  engaged: "tier:engaged",
  reachable: "tier:reachable",
  subscribed: "tier:subscribed",
  imported: "tier:imported",
  suppressed: "tier:suppressed",
};

export const TIER_META: Record<Tier, { label: string; hint: string; color: string }> = {
  engaged: {
    label: "Engaged",
    hint: "Messaged us in the last 90 days. Meta delivers to these people.",
    color: "var(--pm-green)",
  },
  reachable: {
    label: "Ever replied",
    hint: "Has messaged us at some point, but not in the last 90 days.",
    color: "#1d4ed8",
  },
  subscribed: {
    label: "Opted in on site",
    hint: "Typed their number into our storefront popup and agreed to the wording. Has not messaged us yet.",
    color: "var(--pm-gold)",
  },
  imported: {
    label: "Imported, never replied",
    hint: "Phone came from a Shopify order or a CRM/CSV import. Never messaged us. Meta blocks most marketing to this group.",
    color: "var(--pm-muted)",
  },
  suppressed: {
    label: "Suppressed",
    hint: "Opted out, or Meta refused 3+ marketing messages to them in 90 days.",
    color: "var(--pm-terra)",
  },
};

/** Map a `tier:*` tag back to its bare tier name. */
export function tierFromTag(tag: string): Tier | null {
  const bare = tag.startsWith("tier:") ? tag.slice(5) : tag;
  return (TIERS as readonly string[]).includes(bare) ? (bare as Tier) : null;
}

/** The tier tag on a contact's tag array, if the tier refresh has run. */
export function tierOf(tags: string[] | null | undefined): Tier | null {
  for (const t of tags ?? []) {
    const tier = tierFromTag(t);
    if (tier && t.startsWith("tier:")) return tier;
  }
  return null;
}

// Audience presets offered in the campaign builder. Ordered best-first; the
// first entry is the default for every new marketing campaign.
export type AudiencePreset = {
  key: string;
  label: string;
  hint: string;
  tiers: Tier[];
  /** No tag filter at all — the send engine takes every opted-in contact. */
  everyone?: boolean;
};

export const AUDIENCE_PRESETS: AudiencePreset[] = [
  {
    key: "engaged",
    label: "Engaged only",
    hint: "Replied to us in the last 90 days. Highest delivery, smallest list.",
    tiers: ["engaged"],
  },
  {
    key: "warm",
    label: "Engaged + consented",
    hint: "Everyone who has ever replied, plus people who opted in on the website.",
    tiers: ["engaged", "reachable", "subscribed"],
  },
  {
    key: "not_suppressed",
    label: "Everyone except suppressed",
    hint: "Adds the imported phones. Leaves out opt-outs and repeatedly blocked numbers.",
    tiers: ["engaged", "reachable", "subscribed", "imported"],
  },
  {
    key: "everyone",
    label: "Everyone opted-in",
    hint: "The whole list, including numbers Meta keeps refusing. Rarely the right answer.",
    tiers: [],
    everyone: true,
  },
];

export const DEFAULT_AUDIENCE_PRESET = AUDIENCE_PRESETS[0].key;

/** Tag filter a preset resolves to. Empty array = no filter (everyone). */
export function presetTags(preset: AudiencePreset): string[] {
  return preset.everyone ? [] : preset.tiers.map((t) => TIER_TAGS[t]);
}

/**
 * The cold share of an audience: contacts who have never messaged us and never
 * gave us an explicit opt-in. `imported` + `suppressed` is the honest bucket —
 * suppressed contacts are still opted_in in the database and still get picked up
 * by an unfiltered send.
 */
export function coldCount(byTier: Partial<Record<Tier, number>>): number {
  return (byTier.imported ?? 0) + (byTier.suppressed ?? 0);
}

/**
 * Plain-language warning for a selected audience, or null when the audience is
 * clean. `blockRate` is the REAL share of marketing messages Meta refused to
 * this kind of contact over the last 30 days (0-1); when we have no recent
 * sends to measure, the sentence about Meta is left out rather than invented.
 */
export function audienceWarning(
  total: number,
  byTier: Partial<Record<Tier, number>>,
  blockRate: number | null,
): { text: string; severity: "warn" | "danger" } | null {
  const cold = coldCount(byTier);
  if (!total || cold === 0) return null;
  const share = cold / total;
  const n = (v: number) => v.toLocaleString("en-IN");

  let text = `${n(cold)} of these ${n(total)} contacts have never messaged us.`;
  if (blockRate != null && blockRate > 0) {
    const inTen = Math.round(blockRate * 10);
    text += ` Meta blocked ${inTen} in 10 marketing messages to contacts like these over the last 30 days.`;
  }
  const suppressed = byTier.suppressed ?? 0;
  if (suppressed > 0) {
    text += ` ${n(suppressed)} are suppressed (opted out, or already refused 3+ times).`;
  }
  return { text, severity: share >= 0.5 ? "danger" : "warn" };
}

// The exact wording a shopper agrees to in the storefront opt-in popup. Stored
// verbatim on wa_contacts.consent_text and in wa_consent_events so we can always
// show what a given person actually said yes to. Change this and new opt-ins
// record the new wording; existing records keep the wording they agreed to.
export const POPUP_CONSENT_TEXT =
  "By joining you agree to receive WhatsApp updates from PROMUNCH. Reply STOP anytime to leave.";
