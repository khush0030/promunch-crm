// Shared constants for the B2B Find step.

// The "Find companies" modal's category picker. `label` is what the person
// sees; `query` is the phrasing sent to Google Places (kept plain/singular —
// what tests well as a search term isn't always the friendliest button text).
export const CATEGORY_PRESETS: { label: string; query: string }[] = [
  { label: "Gifting companies", query: "corporate gifting company" },
  { label: "Pharma companies", query: "pharmaceutical company" },
  { label: "Airline catering service", query: "airline catering service" },
  { label: "Corporate office", query: "corporate office" },
  { label: "Business hotel", query: "business hotel" },
  { label: "Co-working space", query: "coworking space" },
  { label: "Event management company", query: "event management company" },
];

export const DEFAULT_CITIES = ["Mumbai", "Delhi", "Bangalore", "Gurgaon", "Pune", "Hyderabad"];

// PROMUNCH products a scrape can be aimed at (drives the cold-email pitch).
export const PRODUCT_OPTIONS = ["Edamame", "Soya Crunchies", "Soya Sticks", "Soya Chips"];
