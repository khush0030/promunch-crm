// Shared constants for the B2B Leads dashboard. Extracted from
// dashboard/leads/page.tsx.

import { CheckCircle2, MailSearch, MapPin, PenLine } from "lucide-react";

// Simple workflow tabs instead of one tab per raw status.
export const TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "scrapes", label: "Scrapes", statuses: [] },
  { key: "review", label: "To review", statuses: ["drafted"] },
  { key: "replies", label: "Replies", statuses: ["replied"] },
  { key: "sent", label: "Sent", statuses: ["contacted", "replied", "bounced"] },
  { key: "all", label: "All leads", statuses: [] },
  { key: "skipped", label: "Skipped", statuses: ["no_contacts", "no_website", "listed", "suppressed"] },
];

export const PROCESSING_STATUSES = ["new", "crawling", "ready", "drafting"];

export const DEFAULT_CATEGORIES = [
  "corporate gifting company",
  "airline catering service",
  "corporate office",
  "business hotel",
  "coworking space",
  "event management company",
];

export const DEFAULT_CITIES = ["Mumbai", "Delhi", "Bangalore", "Gurgaon", "Pune", "Hyderabad"];

// PROMUNCH products a scrape can be aimed at (drives the cold-email pitch).
export const PRODUCT_OPTIONS = ["Edamame", "Soya Crunchies", "Soya Sticks", "Soya Chips"];

// Plain-language walkthrough of the whole pipeline, shown in the strip + Guide modal.
export const GUIDE_STEPS: { icon: typeof MapPin; title: string; blurb: string }[] = [
  {
    icon: MapPin,
    title: "1. Find companies",
    blurb: "Pick the kinds of business you sell to (corporate gifting, vending, hotels…) and the cities. We search Google for matching companies.",
  },
  {
    icon: MailSearch,
    title: "2. We find the emails",
    blurb: "The pipeline visits each company's site, pulls real email addresses, verifies them, and an AI scores how good a fit they are (0–100) with a reason.",
  },
  {
    icon: PenLine,
    title: "3. AI writes the email",
    blurb: "For good-fit leads with a verified email, AI drafts a personal cold email grounded in the PROMUNCH knowledge base. Drafts land in “To review”.",
  },
  {
    icon: CheckCircle2,
    title: "4. Review & send",
    blurb: "Open a lead, tweak the subject or body if you want, then hit Approve & send. Replies come to your inbox — mark them “Replied” here.",
  },
];

export const GUIDE_DISMISS_KEY = "leads_guide_dismissed_v1";
