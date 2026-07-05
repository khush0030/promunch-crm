// Status pill color maps for the B2B Leads dashboard. Extracted from
// dashboard/leads/page.tsx.

export const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  new: { cls: "bg-gray", label: "Queued" },
  crawling: { cls: "bg-gold", label: "Crawling" },
  ready: { cls: "bg-gold", label: "Needs draft" },
  no_contacts: { cls: "bg-gray", label: "No contacts" },
  no_website: { cls: "bg-gray", label: "No website" },
  listed: { cls: "bg-gray", label: "Listed (no email)" },
  drafting: { cls: "bg-gold", label: "Drafting" },
  drafted: { cls: "bg-green", label: "Review draft" },
  contacted: { cls: "bg-green", label: "Sent" },
  replied: { cls: "bg-green", label: "Replied" },
  bounced: { cls: "bg-terra", label: "Bounced" },
  suppressed: { cls: "bg-terra", label: "Suppressed" },
};

export const CONFIDENCE_PILL: Record<string, string> = { high: "bg-green", medium: "bg-gold", low: "bg-gray" };

export const SEARCH_STATUS_PILL: Record<string, { cls: string; label: string }> = {
  pending: { cls: "bg-gray", label: "Queued" },
  running: { cls: "bg-gold", label: "Running" },
  done: { cls: "bg-green", label: "Done" },
  error: { cls: "bg-terra", label: "Error" },
};
