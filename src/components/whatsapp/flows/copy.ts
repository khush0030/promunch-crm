// What switching each built-in automation on or off means for customers.
// Shown in the ConfirmDialog before the change is saved.

import type { BoolKey } from "./types";

export const TOGGLE_COPY: Partial<Record<BoolKey, { name: string; on: string; off: string }>> = {
  abandoned_cart_enabled: {
    name: "Abandoned cart reminders",
    on: "People who leave items in their cart from now on will get a WhatsApp reminder, and later a coupon message if they still have not ordered.",
    off: "No new cart reminders will go out. Reminders already waiting are held (not deleted) and continue if you turn this back on.",
  },
  review_request_enabled: {
    name: "Review ask",
    on: "Customers will be asked on WhatsApp for a review a few days after they order.",
    off: "No new review asks will go out. Asks already waiting are held (not deleted) and continue if you turn this back on.",
  },
  replenishment_enabled: {
    name: "Restock reminder",
    on: "Customers will get a WhatsApp nudge to order again around when their snacks run out.",
    off: "No new restock reminders will go out. Reminders already waiting are held (not deleted) and continue if you turn this back on.",
  },
  order_confirmation_enabled: {
    name: "Order confirmation",
    on: "Every new order will get a WhatsApp confirmation a few seconds after checkout.",
    off: "New orders will NOT get a WhatsApp confirmation. Customers often message support when they get no confirmation.",
  },
  cod_gate_enabled: {
    name: "Cash on delivery confirmation",
    on: "New cash-on-delivery orders will be held in Shopify until the customer taps Confirm on WhatsApp.",
    off: "Cash-on-delivery orders will ship without asking the customer to confirm first.",
  },
  shipping_update_enabled: {
    name: "Shipping update",
    on: "Customers will get a WhatsApp message with their tracking link when their order ships.",
    off: "Customers will NOT get a WhatsApp message when their order ships.",
  },
  voice_call_enabled: {
    name: "Cart call",
    on: "Customers who leave their cart get one friendly AI phone call a few minutes later, within the calling hours you set. If the call connects, the WhatsApp cart reminders are skipped.",
    off: "No more cart phone calls will be placed. WhatsApp and email cart reminders carry on as usual.",
  },
  cod_voice_enabled: {
    name: "COD confirmation calls",
    on: "Customers who have not confirmed a COD order will get an AI phone call.",
    off: "No more COD confirmation phone calls will be placed.",
  },
};
