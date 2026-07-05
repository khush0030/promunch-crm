// Shared constants for the B2B Leads dashboard. Extracted from
// dashboard/leads/page.tsx.

import { CheckCircle2, MailSearch, MapPin, PenLine } from "lucide-react";

// v2 tabs: Lists are the primary object; sending happens through sequences.
export const TABS: { key: string; label: string }[] = [
  { key: "lists", label: "Lists" },
  { key: "sequences", label: "Sequences" },
  { key: "templates", label: "Templates" },
  { key: "replies", label: "Replies" },
  { key: "analytics", label: "Analytics" },
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
    title: "3. Build templates & a sequence",
    blurb: "Write email templates (or let AI draft three options), then chain them into a sequence: intro, wait a few days, follow-up. Variables like {company} fill in per lead.",
  },
  {
    icon: CheckCircle2,
    title: "4. Enroll the list",
    blurb: "Open a list and hit “Enroll in sequence”. Emails go out automatically inside the send window and daily cap; anyone who replies is stopped and lands in Replies.",
  },
];

export const GUIDE_DISMISS_KEY = "leads_guide_dismissed_v1";
