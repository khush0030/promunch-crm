# 01 · Brand extraction (promunch.in → CRM)

Checked live on 7 Oct 2026: `https://promunch.in` loaded in Playwright at 1440px. Computed styles were read from the DOM, theme CSS variables were grepped from the served HTML, and the header logo was downloaded to `assets/promunch-logo.png`. The 5 Oct storefront audit (`docs/audits/2026-10-05-storefront/`) and revamp concept (`docs/plans/2026-10-05-storefront-revamp/`) were read too. Note: the revamp concept proposes Bricolage Grotesque + DM Sans + lime/pink/lilac. **That is a proposal, not the live brand**, so the CRM follows the live site.

## What the live site actually uses

| Thing | Live value (measured) | Where it shows |
|---|---|---|
| Display font | **Archivo Black** (`--fdisp`, `--font-heading-family`) | Hero "CHIPS COULD NEVER." at 100px, uppercase, tracking -3.5px; all h1–h3; buttons ("SHOP THE LINEUP", "JOIN") |
| Body font | **Assistant** 400/600/700 (`--fbody`), 16px, letter-spacing 0.6px | Body copy, header, footer |
| Label font | **JetBrains Mono** uppercase, wide tracking | Nav ("HOME · GIFT HAMPER · ROASTED EDAMAME BEANS"), eyebrows ("★ MASALA MANIA"), "SCROLL ↓" |
| Brand red | **#AF272F** (`--accent`, `--pg-accent`) | Full-bleed hero, primary buttons, logo, links |
| Deep red | **#8E1F26** (`--accent-deep`) | Hover / pressed |
| Ink | **#1A1714** (`--ink`), ink-2 **#3B342E**, mute **#5C554E** | Text |
| Paper | **#F4F1EA** (`--pg-paper`), white **#FFFFFF** | Light sections, cards |
| Hairline | **#E7E2D8** / #E5E0D6 | Dividers |
| Sun yellow | **#FEBD11** (theme scheme) | Highlight scheme, sticker accents |
| Orange | **#EF5B31** (theme scheme), Masala Mania pack | Accent scheme |
| Green | **#2E7D46** | "good" states in the protein game |
| Footer | **#100E0C** near-black | Footer, newsletter band |
| Radius | buttons **14px**; cards **20–26px**; pills **999px** | Nav is a white 20px-rounded floating bar; category cards 26px |
| Shadow | `0 6px 24px rgba(26,23,20,.12)` (cards), `0 10px 24px rgba(175,39,47,.30)` (red CTA) | Sparingly |
| Texture | Fine diagonal pinstripe over red | Hero |
| Pack colours | Masala Mania orange, Himalayan Rock Salt teal, white pouch with red PROMUNCH wordmark | Product shots |

All three fonts are on Google Fonts, so no substitutes are needed.

## Voice (from live copy)

Short, loud, cheeky, confident: "CHIPS COULD NEVER.", "THE MATH IS BRUTAL.", "PICK YOUR CRUNCH.", "QUIETLY RETIRING YOUR SNACK DRAWER.", "No spam, no apologies." Star-prefixed mono eyebrows ("★ THREE WAYS TO WIN 4PM").

**For the CRM we take the confidence, not the volume.** Shouting is reserved for page titles and empty states. Everything a teammate has to act on is plain, calm English: "3 orders need a call", not "ORDERS NEED YOU!!".

## The CRM token set (what `app.css` implements)

### Fonts
- `--f-display: 'Archivo Black'` page titles (UPPERCASE, 1 to 2 words, like the site nav), KPI numbers, empty-state headlines. Never for sentences.
- `--f-body: 'Assistant'` everything you read: 16px body, 15px tables, 600/700 for emphasis.
- `--f-mono: 'JetBrains Mono'` eyebrows, table column labels, timestamps, IDs (#PM-2841), keyboard hints. Uppercase only at 11–12px.
- Google Fonts URL: `https://fonts.googleapis.com/css2?family=Archivo+Black&family=Assistant:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap`

### Type scale (laptop / phone)
| Token | Font | Size / line | Use |
|---|---|---|---|
| `display` | Archivo Black | 44/46 · 32/34 | Home greeting, portal hero only |
| `h1` | Archivo Black, uppercase, -0.02em | 30/34 · 24/28 | Page title |
| `h2` | Archivo Black | 20/26 · 18/24 | Section title |
| `h3` | Assistant 700 | 17/24 | Card title |
| `kpi` | Archivo Black | 34/38 · 28/32 | Headline numbers |
| `body` | Assistant 400 | 16/24 | Default |
| `small` | Assistant 500 | 14/20 | Meta, table secondary line |
| `eyebrow` | JetBrains Mono 700, +0.12em, uppercase | 11.5/16 | "★ NEEDS YOU", column labels |

Minimum readable size anywhere in the app: 13px (mono labels), 14px (any sentence).

### Colour roles
| Token | Hex | Role | Rule |
|---|---|---|---|
| `--paper` | #F4F1EA | App background | |
| `--surface` | #FFFFFF | Cards, sidebar, drawers | |
| `--surface-2` | #FAF8F3 | Inset rows, inputs, hover | |
| `--hair` | #E7E2D8 | Borders | 1px only |
| `--ink` | #1A1714 | Text, dark buttons | |
| `--ink-2` | #3B342E | Secondary text | darkened 7 Oct after owner review |
| `--mute` | #5C554E | Captions, subtext, placeholders | ~7:1 on white, darkened 7 Oct after owner review |
| `--red` | #AF272F | **The one accent**: primary button, active nav, key number, links | Max one red-filled element per view |
| `--red-deep` | #8E1F26 | Hover/pressed | |
| `--red-soft` | #F8E7E5 | Active nav fill, selected row | |
| `--sun` | #FEBD11 | Maya (AI) only, plus "new" stickers | The quirky pop; never for status |
| `--good` / soft | #2E7D46 / #E4F1E7 | Done, confirmed, healthy | |
| `--warn` / soft | #A96500 / #FCEFD6 | Waiting, at risk, due soon | |
| `--bad` / soft | #B3261E / #FBE3DF | Failed, overdue, breached | Always paired with a word + icon (never colour alone) |
| `--info` / soft | #1F7A8C / #E1F0F2 | Neutral info, bot, "pending customer" | Teal from the Himalayan Rock Salt pack |
| `--night` | #100E0C | Tooltips, toasts, footer-like dark bands | |

Chart series (in this order, validated for contrast on white): D2C web `#AF272F`, Amazon `#D99A00` (darkened sun), HYPD `#1F7A8C` (teal), WhatsApp `#2E7D46`, Email `#4A423C`, Masala Mania `#EF5B31`. Single-series charts are always red with a 12% red area fill. Gridlines `#EFEBE3`, axis text mono 11px `--mute`.

### Shape, depth, spacing
- Radius: cards `20px`, drawers/modals `24px`, buttons `14px` (site exact), inputs `12px`, chips/pills `999px`.
- Shadow: cards are flat with a 1px hairline. Only floating things get shadow: menus/modals `0 24px 60px rgba(26,23,20,.18)`, sticky composer `0 6px 24px rgba(26,23,20,.08)`. Primary red button gets the site's red glow on hover only.
- Spacing scale 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64. Card padding 24 (laptop) / 18 (phone). Page gutters 40 / 16. Row height in tables 60px.
- Texture: the site's diagonal pinstripe, used once: on the red Home greeting band.

### Iconography
Lucide (already used in the app), 1.75 stroke, 20px in nav, 18px inline, always paired with a text label in navigation. No emoji in UI chrome. The site's "★" is used as the eyebrow glyph.

### Copy rules baked into every screen
- **PROMUNCH** always in caps. Tagline **"Your Munchy Pal"** in the sidebar foot, login and creator portal.
- **No em dashes** anywhere in copy (we use commas, colons or "·").
- Never mention the old agency or infrastructure name in any copy (AGENTS.md §5).
- Business words, not engineering words: "Number not on WhatsApp", not "#131026"; "paid to you", not "net settlement".
- Product facts as in the Master KB: Edamame Himalayan Rock Salt 45g protein/100g; Indori Chatka and Masala Mania 42g; olive oil is Edamame only; Crunchies are roasted; chips and sticks are fried.
