// Bulk order inquiry: shared definitions for the storefront form
// (/api/public/bulk-form-embed), the intake route (/api/public/bulk-inquiry)
// and the auto-reply email. Pure: no imports, safe for vitest.
//
// Form vs email split (approved Oct 7 2026): the form asks only what routes
// the lead; the email asks 2 type-specific questions + 3 common ones.

export const USE_CASES = {
  gifting: { label: "Corporate gifting", dealKind: "corporate_pantry_gifting", subject: "Your PROMUNCH gifting quote" },
  pantry: { label: "Office pantry", dealKind: "corporate_pantry_gifting", subject: "Your PROMUNCH office pantry quote" },
  events: { label: "Event", dealKind: "events_expo", subject: "Your PROMUNCH event quote" },
  resale: { label: "Resale / distribution", dealKind: "distribution_wholesale", subject: "Your PROMUNCH wholesale quote" },
  other: { label: "Something else", dealKind: "other", subject: "Your PROMUNCH bulk quote" },
} as const;
export type UseCase = keyof typeof USE_CASES;

export const QUANTITY_BANDS = {
  "50-100": "50 to 100 units",
  "100-500": "100 to 500 units",
  "500-2000": "500 to 2,000 units",
  "2000+": "2,000+ units",
  unsure: "Quantity not decided",
} as const;
export type QuantityBand = keyof typeof QUANTITY_BANDS;

export const PRODUCTS = {
  edamame: "Roasted edamame",
  crunchies: "Soya crunchies",
  chips: "Chips",
  sticks: "Sticks",
  hampers: "Gift hampers",
  help: "Help me choose",
} as const;
export type ProductKey = keyof typeof PRODUCTS;

/** Questions asked of every order type, after the type-specific ones. */
export const COMMON_QUESTIONS = [
  "Budget per unit, if you have one",
  "Delivery pincode",
  "GSTIN, if you need a GST invoice",
] as const;

export const TYPE_QUESTIONS: Record<UseCase, readonly string[]> = {
  gifting: ["Logo or custom branding on the box?", "One address, or ship to each person?"],
  pantry: ["How many people snack daily?", "Weekly or monthly delivery?"],
  events: ["Event name and date", "Sampling, goodie bags or on-site sale?"],
  resale: ["Type of outlet and cities you cover", "Expected monthly volume"],
  other: ["What the snacks are for", "Rough quantity you have in mind"],
};

/** Questions for the email. When quantity is unknown, ask it first (quoting needs it). */
export function questionsFor(useCase: UseCase, quantityUnknown = false): string[] {
  // resale asks monthly volume and other asks quantity already.
  const ask = quantityUnknown && (useCase === "gifting" || useCase === "pantry" || useCase === "events") ? ["Rough quantity (units or hampers)"] : [];
  return [...ask, ...TYPE_QUESTIONS[useCase], ...COMMON_QUESTIONS];
}

/** Opener used when the AI line is unavailable or fails validation. */
export function fallbackOpener(useCase: UseCase, company: string): string {
  const who = company.trim() ? ` for ${company.trim()}` : "";
  const what: Record<UseCase, string> = {
    gifting: `Thanks for thinking of PROMUNCH for gifting${who}.`,
    pantry: `Thanks for thinking of PROMUNCH for your office pantry${who ? who.replace(" for", " at") : ""}.`,
    events: `Thanks for thinking of PROMUNCH for your event.`,
    resale: `Great to hear you want to stock PROMUNCH.`,
    other: `Thanks for reaching out to PROMUNCH about a bulk order${who}.`,
  };
  return `${what[useCase]} Here is what we need to send you pricing.`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface BulkInquiryInput {
  submissionKey: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  city: string;
  useCase: UseCase;
  quantityBand: QuantityBand;
  products: ProductKey[];
  neededBy: string | null; // YYYY-MM-DD
  notes: string | null;
  pageUrl: string | null;
}

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Validate + normalise a raw POST body. Returns field errors keyed by field. */
export function parseBulkInquiry(raw: Record<string, unknown>):
  | { ok: true; value: BulkInquiryInput }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = clip(raw.name, 80);
  const company = clip(raw.company, 120);
  const email = clip(raw.email, 160).toLowerCase();
  const phoneDigits = String(raw.phone ?? "").replace(/[^\d+]/g, "");
  const city = clip(raw.city, 80);
  const useCase = String(raw.useCase ?? "") as UseCase;
  const quantityBand = String(raw.quantityBand ?? "") as QuantityBand;
  const submissionKey = clip(raw.submissionKey, 64);

  if (!/^[A-Za-z0-9_-]{8,64}$/.test(submissionKey)) errors.submissionKey = "Please reload the page and try again.";
  if (name.length < 2) errors.name = "Please enter your name.";
  if (company.length < 2) errors.company = "Please enter your company or organisation.";
  if (!EMAIL_RE.test(email)) errors.email = "Please enter a valid email.";
  const digitsOnly = phoneDigits.replace(/\D/g, "");
  if (digitsOnly.length < 10 || digitsOnly.length > 15) errors.phone = "Please enter a valid phone number.";
  if (city.length < 2) errors.city = "Please enter the delivery city.";
  if (!(useCase in USE_CASES)) errors.useCase = "Please pick what this is for.";
  if (!(quantityBand in QUANTITY_BANDS)) errors.quantityBand = "Please pick a rough quantity.";

  const products = Array.isArray(raw.products)
    ? [...new Set(raw.products.map(String).filter((p): p is ProductKey => p in PRODUCTS))]
    : [];

  let neededBy: string | null = null;
  const nb = String(raw.neededBy ?? "").trim();
  if (nb) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(nb) && !Number.isNaN(Date.parse(nb + "T00:00:00Z"))) neededBy = nb;
    else errors.neededBy = "Please pick a valid date.";
  }

  const notes = clip(raw.notes, 1500) || null;
  const pageUrl = clip(raw.pageUrl, 300) || null;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      submissionKey, name, company, email,
      phone: phoneDigits.startsWith("+") ? phoneDigits : `+${digitsOnly.length === 10 ? "91" + digitsOnly : digitsOnly}`,
      city, useCase, quantityBand, products, neededBy, notes, pageUrl,
    },
  };
}

/** First name for greetings ("Riya Sharma" -> "Riya"). */
export function firstName(name: string): string {
  const f = name.trim().split(/\s+/)[0] ?? "";
  return f ? f.charAt(0).toUpperCase() + f.slice(1) : "there";
}

/** "28 Oct" style date for the recap tags. */
export function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|icloud|me|rediffmail|proton|protonmail|aol|zoho)\./i;
/** Company domain for deal matching, or null for personal mailboxes. */
export function companyDomain(email: string): string | null {
  if (FREE_MAIL.test(email)) return null;
  const d = email.split("@")[1]?.toLowerCase();
  return d && d.includes(".") ? d : null;
}

/** Strip characters the copy rules ban and fix brand casing. */
export function cleanCopy(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\bpromunch\b/gi, "PROMUNCH")
    .replace(/\s+/g, " ")
    .trim();
}
