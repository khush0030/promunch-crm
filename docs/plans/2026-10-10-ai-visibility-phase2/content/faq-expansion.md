# FAQ expansion: 15 more Q&As for promunch.in/pages/faqs

Written 10 Oct 2026. Status: draft, nothing installed.

These 15 questions add to the 9 already in `docs/plans/2026-10-10-ai-visibility-phase1/theme/faq-jsonld-corrected.liquid` (read only, not edited). None of them repeat those 9. Every answer uses only facts from `docs/plans/2026-10-10-ai-visibility-phase1/brand-facts/`, or a visible `[CONFIRM: ...]` marker.

## How to use this file

1. Resolve every `[CONFIRM]` marker in the Q&A list below, or delete that Q&A.
2. Add the Q&As to the visible FAQ page (Online Store, Pages, FAQs). Each answer must appear on the visible page in the same meaning as in the JSON-LD. Google and AI tools both expect the two to match.
3. Add the matching JSON-LD entries to the FAQPage block in `layout/theme.liquid`. The ready-made JSON below contains only the 12 Q&As that have no open markers. Paste it inside the `mainEntity` array, after the last existing question (add a comma after that question's closing `}` first).
4. After the 3 marked Q&As are resolved, add them to the JSON-LD in the same format.
5. Check the page with Google's Rich Results Test after saving.

Copy rules applied: PROMUNCH in capitals, no em dashes or en dashes, no "best" or "No. 1" claims, no medical or weight-loss claims, short answers that can be quoted whole.

## The 15 Q&As

### Products and how they are made

**1. Is edamame a soya snack?**
Yes. Edamame is young soybean, so PROMUNCH Roasted Edamame is a soya snack too.

**2. What oil is used to roast PROMUNCH Roasted Edamame?**
PROMUNCH Roasted Edamame is roasted in olive oil. Olive oil is used for our Roasted Edamame only.

**3. Which PROMUNCH snacks are fried?**
Soya Sticks and Soya Chips are fried, for a classic chip crunch. Roasted Edamame and Soya Crunchies are roasted, not fried.

**4. What flavours do Soya Sticks and Soya Chips come in?**
Soya Sticks come in Chatpata Masala and Cream & Onion. Soya Chips come in Peri Peri. [CONFIRM: full flavour list for Soya Sticks and Soya Chips]

**5. Is any PROMUNCH snack Jain friendly?**
Yes. Tangy Pudina Soya Crunchies is our only Jain friendly product.

**6. How much protein is in a 25g pack of PROMUNCH Roasted Edamame?**
About 10.5g to 11.3g. PROMUNCH Roasted Edamame has 42g to 45g of protein per 100g, depending on the flavour.

**7. How much protein is in Soya Crunchies, Soya Sticks and Soya Chips?**
[CONFIRM: protein per 100g for Soya Crunchies, Soya Sticks and Soya Chips, from the pack labels.] The nutrition table on each pack shows the exact amount. (Only call a line "high protein" if it meets the FSSAI threshold.)

**8. Are PROMUNCH snacks vegetarian, vegan or gluten free?**
[CONFIRM: vegetarian, vegan and gluten free status for each product line, from the pack labels.] Until confirmed, the answer should be: "Please check the pack label for each product."

### Packs, combos and bulk

**9. What pack sizes does PROMUNCH sell?**
Soya Crunchies come in 150g packs and multipacks. Soya Sticks and Soya Chips come in 80g packs and combos. Roasted Edamame comes in single flavour packs, a Roasted Edamame Combo with all 3 flavours, and an Edamame Travel Combo of 9 packs of 25g.

**10. Does PROMUNCH sell combos and gift packs?**
Yes. Options include the Big Bite Munch Combo (7 packs of Sticks, Chips and Crunchies), the Soya Sticks and Chips Combo (3 packs of 80g), the Roasted Edamame Combo, the Edamame Travel Combo and gift hampers. See the combos and gift packs collection on promunch.in.

**11. Does PROMUNCH take bulk and corporate orders?**
Yes. PROMUNCH supplies office pantries and takes orders for corporate gifting, festive hampers, events, gyms and resale. Use the bulk order form at promunch.in/pages/bulk-orders.

### Orders, payment and support

**12. How can I pay less on a promunch.in order?**
Pay online: prepaid orders get 5% off. Orders of ₹599 or more ship free; below ₹599, shipping is ₹99. Cash on delivery adds ₹50.

**13. How do I track my PROMUNCH order?**
Every order has an order status page on promunch.in where you can track it. The link is in your order confirmation. [CONFIRM: the PROMUNCH confirmation email and WhatsApp message include this link]

**14. How do I contact PROMUNCH customer care?**
Email hello@promunch.in or WhatsApp +91 99813 10247. Support hours are Monday to Friday, 10 am to 6 pm, and Saturday, 10 am to 5 pm (IST).

**15. Where is PROMUNCH based?**
PROMUNCH is based in Dewas, Madhya Pradesh, India. Our address is 28, AB Rd, Industrial Area No. 1, Dewas, Madhya Pradesh 455001.

### Note on Q13

"The link is in your order confirmation" is standard Shopify behaviour (the order confirmation email links to the order status page). [CONFIRM: the PROMUNCH confirmation email and WhatsApp message include this link.] If not, drop that sentence. This Q&A is included in the JSON below without that sentence.

## JSON-LD to append (12 Q&As with no open markers)

Excluded until resolved: Q4, Q7, Q8.

```json
    {
      "@type": "Question",
      "name": "Is edamame a soya snack?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Edamame is young soybean, so PROMUNCH Roasted Edamame is a soya snack too."
      }
    },
    {
      "@type": "Question",
      "name": "What oil is used to roast PROMUNCH Roasted Edamame?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "PROMUNCH Roasted Edamame is roasted in olive oil. Olive oil is used for our Roasted Edamame only."
      }
    },
    {
      "@type": "Question",
      "name": "Which PROMUNCH snacks are fried?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Soya Sticks and Soya Chips are fried, for a classic chip crunch. Roasted Edamame and Soya Crunchies are roasted, not fried."
      }
    },
    {
      "@type": "Question",
      "name": "Is any PROMUNCH snack Jain friendly?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Tangy Pudina Soya Crunchies is our only Jain friendly product."
      }
    },
    {
      "@type": "Question",
      "name": "How much protein is in a 25g pack of PROMUNCH Roasted Edamame?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "About 10.5 g to 11.3 g. PROMUNCH Roasted Edamame has 42 to 45 g of protein per 100 g, depending on the flavour."
      }
    },
    {
      "@type": "Question",
      "name": "What pack sizes does PROMUNCH sell?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Soya Crunchies come in 150g packs and multipacks. Soya Sticks and Soya Chips come in 80g packs and combos. Roasted Edamame comes in single flavour packs, a Roasted Edamame Combo with all 3 flavours, and an Edamame Travel Combo of 9 packs of 25g."
      }
    },
    {
      "@type": "Question",
      "name": "Does PROMUNCH sell combos and gift packs?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Options include the Big Bite Munch Combo (7 packs of Sticks, Chips and Crunchies), the Soya Sticks and Chips Combo (3 packs of 80g), the Roasted Edamame Combo, the Edamame Travel Combo and gift hampers. See the combos and gift packs collection on promunch.in."
      }
    },
    {
      "@type": "Question",
      "name": "Does PROMUNCH take bulk and corporate orders?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. PROMUNCH supplies office pantries and takes orders for corporate gifting, festive hampers, events, gyms and resale. Use the bulk order form at promunch.in/pages/bulk-orders."
      }
    },
    {
      "@type": "Question",
      "name": "How can I pay less on a promunch.in order?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Pay online: prepaid orders get 5% off. Orders of ₹599 or more ship free; below ₹599, shipping is ₹99. Cash on delivery adds ₹50."
      }
    },
    {
      "@type": "Question",
      "name": "How do I track my PROMUNCH order?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Every order has an order status page on promunch.in where you can track it."
      }
    },
    {
      "@type": "Question",
      "name": "How do I contact PROMUNCH customer care?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Email hello@promunch.in or WhatsApp +91 99813 10247. Support hours are Monday to Friday, 10 am to 6 pm, and Saturday, 10 am to 5 pm (IST)."
      }
    },
    {
      "@type": "Question",
      "name": "Where is PROMUNCH based?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "PROMUNCH is based in Dewas, Madhya Pradesh, India. Our address is 28, AB Rd, Industrial Area No. 1, Dewas, Madhya Pradesh 455001."
      }
    }
```

The last entry has no trailing comma, so it can sit at the end of the array. If you paste these before the existing entries instead, add a comma after the last one.

## Consistency checks against the existing 9 FAQ entries

| Existing question (phase 1 JSON-LD) | New Q&As that must stay consistent |
|---|---|
| What are PROMUNCH snacks made of? | Q1, Q2, Q3 (same roasted vs fried split) |
| Are PROMUNCH snacks roasted or fried? | Q3 repeats the same facts from the other direction, for people who ask "which are fried" |
| How much protein is in PROMUNCH Roasted Edamame? | Q6 uses the same 42 to 45g per 100g range |
| Which flavours does PROMUNCH make? | Q4 adds Sticks and Chips flavours once confirmed; the existing answer lists only Edamame and Crunchies |
| Is shipping free? / Do you offer cash on delivery? | Q12 uses the same ₹599, ₹99, ₹50 and 5% figures |
| Where can I buy PROMUNCH snacks? | Q11 (bulk) adds a channel; no conflict |
| Who founded PROMUNCH? | Q15 adds the address; same city and state |

Deliberately left out (not supported by brand facts): gluten free claims, shelf life, storage after opening, delivery time, FSSAI licence, "4x more protein than an egg", kids' tiffin use, health or weight claims.
