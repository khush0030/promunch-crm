// Email Studio design model. An email is a list of blocks (data, not HTML):
// the builder edits it, render.ts turns it into email-safe HTML, and
// templates are just saved designs. Pure + isomorphic (the builder renders
// its live preview in the browser with the same code the sender uses).
//
// Keep imports relative: vitest has no "@/" alias.

import { EMAIL_BRAND, EMAIL_COLORS, SOCIAL_LINKS } from "../email/brand-tokens";

export type Align = "left" | "center";

export type Block =
  | { id: string; type: "logo"; align: Align; showTagline: boolean }
  | { id: string; type: "heading"; text: string; size: "xl" | "lg" | "md"; align: Align }
  | { id: string; type: "text"; text: string; align: Align }
  | { id: string; type: "image"; src: string; alt: string; href: string; padded: boolean }
  | { id: string; type: "button"; label: string; href: string; align: Align; variant: "solid" | "outline" }
  | { id: string; type: "products"; items: string[]; columns: 1 | 2 | 3; showPrice: boolean; buttonLabel: string }
  | { id: string; type: "coupon"; code: string; headline: string; note: string }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; size: number }
  | { id: string; type: "social"; align: Align };

export type BlockType = Block["type"];

export type Theme = {
  /** Page background around the email card. */
  background: string;
  /** The email card itself. */
  content: string;
  text: string;
  /** Headings + accents (coupon border, links). */
  accent: string;
  button: string;
  buttonText: string;
  font: "sans" | "serif";
};

export type EmailDesign = { version: 1; theme: Theme; blocks: Block[] };

/** Brand kit: set once in Email Studio → Brand, applied to every email. */
export type BrandKit = {
  logoUrl: string;
  logoWidth: number;
  tagline: string;
  website: string;
  instagram: string;
  facebook: string;
  youtube: string;
  footerAddress: string;
  theme: Theme;
};

/** A product as the renderer needs it (from wa_catalog_items). */
export type ProductInfo = {
  id: string;
  title: string;
  price: number | null;
  compareAt: number | null;
  image: string | null;
  url: string;
  inStock: boolean;
};

/**
 * The one PROMUNCH email look, taken from the promunch.in storefront (see
 * email/brand-tokens.ts): cream page, white card, ink text, brand-red CTA.
 * Shared with flow emails. Every built-in template uses it.
 */
export const DEFAULT_THEME: Theme = {
  background: EMAIL_COLORS.page,
  content: EMAIL_COLORS.card,
  text: EMAIL_COLORS.ink,
  accent: EMAIL_COLORS.brand,
  button: EMAIL_COLORS.brand,
  buttonText: EMAIL_COLORS.onBrand,
  font: "sans",
};

export const DEFAULT_BRAND: BrandKit = {
  logoUrl: EMAIL_BRAND.logoUrl,
  logoWidth: EMAIL_BRAND.logoWidth,
  tagline: EMAIL_BRAND.tagline,
  website: EMAIL_BRAND.website,
  instagram: SOCIAL_LINKS.instagram,
  facebook: SOCIAL_LINKS.facebook,
  youtube: SOCIAL_LINKS.youtube,
  footerAddress: "",
  theme: DEFAULT_THEME,
};

/** Merge a stored (possibly partial / older) brand kit over the defaults. */
export function normalizeBrand(raw: unknown): BrandKit {
  const b = (raw && typeof raw === "object" ? raw : {}) as Partial<BrandKit>;
  return {
    ...DEFAULT_BRAND,
    ...b,
    theme: { ...DEFAULT_THEME, ...(b.theme ?? {}) },
  };
}

let seq = 0;
export function newId(): string {
  seq = (seq + 1) % 1_000_000;
  return `b${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A fresh block of a given type with sensible starter content. */
export function makeBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "logo":
      return { id, type, align: "center", showTagline: true };
    case "heading":
      return { id, type, text: "Your headline here", size: "lg", align: "center" };
    case "text":
      return {
        id,
        type,
        text: "Hi {{first_name|there}},\n\nWrite your message here. Use **bold**, *italic* and [links](https://promunch.in).",
        align: "left",
      };
    case "image":
      return { id, type, src: "", alt: "", href: "", padded: false };
    case "button":
      return { id, type, label: "Shop now", href: "https://promunch.in", align: "center", variant: "solid" };
    case "products":
      return { id, type, items: [], columns: 2, showPrice: true, buttonLabel: "Buy now" };
    case "coupon":
      return { id, type, code: "DIWALI15", headline: "15% off your order", note: "Use at checkout. Valid till Nov 8." };
    case "divider":
      return { id, type };
    case "spacer":
      return { id, type, size: 24 };
    case "social":
      return { id, type, align: "center" };
  }
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  logo: "Logo",
  heading: "Heading",
  text: "Text",
  image: "Image",
  button: "Button",
  products: "Products",
  coupon: "Coupon",
  divider: "Divider",
  spacer: "Spacer",
  social: "Social links",
};

export function blankDesign(theme: Theme = DEFAULT_THEME): EmailDesign {
  return {
    version: 1,
    theme: { ...theme },
    blocks: [makeBlock("logo"), makeBlock("heading"), makeBlock("text"), makeBlock("button")],
  };
}

const BLOCK_TYPES = new Set<string>(Object.keys(BLOCK_LABELS));

/**
 * Validate an untrusted design (from a request body). Returns a clean design
 * or null. Unknown block types are dropped rather than rejected so an older
 * client can't wedge a campaign.
 */
export function parseDesign(raw: unknown): EmailDesign | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as { version?: unknown; theme?: unknown; blocks?: unknown };
  if (!Array.isArray(d.blocks)) return null;
  const theme = { ...DEFAULT_THEME, ...(d.theme && typeof d.theme === "object" ? (d.theme as Partial<Theme>) : {}) };
  for (const k of ["background", "content", "text", "accent", "button", "buttonText"] as const) {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(String(theme[k]))) theme[k] = DEFAULT_THEME[k];
  }
  if (theme.font !== "serif") theme.font = "sans";
  const blocks = (d.blocks as unknown[])
    .filter((b): b is Block => !!b && typeof b === "object" && BLOCK_TYPES.has(String((b as Block).type)))
    .slice(0, 80)
    .map((b) => ({ ...makeBlock(b.type), ...b }) as Block);
  return { version: 1, theme, blocks };
}

/** Stable content fingerprint: a test send is valid only for this exact content. */
export function contentHash(subject: string, previewText: string, design: unknown): string {
  const s = JSON.stringify([subject, previewText, design]);
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = (Math.imul(h2, 31) + c) | 0;
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}${s.length.toString(16)}`;
}

/** Product ids referenced by a design (to fetch them before rendering). */
export function productIds(design: EmailDesign): string[] {
  const ids = new Set<string>();
  for (const b of design.blocks) if (b.type === "products") b.items.forEach((i) => ids.add(i));
  return [...ids];
}
