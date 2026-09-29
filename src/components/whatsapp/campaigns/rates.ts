// Numbers behind the campaign wizard's estimates. One place so they are easy
// to update. Source: docs/whatsapp/WA_DELIVERABILITY_PLAYBOOK.md §2, §5.

// Meta India marketing rate per DELIVERED message (a message Meta holds back
// costs nothing). Rate card effective Jul 1 2026 as quoted by Indian BSPs.
// Verify against Meta rate card before quoting to finance:
// https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
export const MARKETING_RATE_INR = 0.8631;
export const GST_RATE = 0.18;

// Conservative share of marketing messages Meta holds back (#131049) for each
// kind of audience, measured on our own sends (playbook §2). Used only for the
// "expect about N held back" estimate; the real outcome shows on the campaign
// page.
export const HELD_BACK_RATE = {
  engaged: 0.45, // messaged us in the last 90 days
  warm: 0.5, // replied, read, or bought recently
  buyers: 0.6, // RFM segments (Shopify buyers)
  retarget: 0.6, // people from an earlier campaign
  cold: 0.7, // imported lists, tags, everyone
} as const;

// Above this share of cold contacts the wizard shows a danger warning and asks
// for a typed confirmation.
export const COLD_SHARE_DANGER = 0.5;
