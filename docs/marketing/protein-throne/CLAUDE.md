# PROMUNCH: "The Protein Throne" AI video series (project context)

This file hands off a project that was started in an earlier session. Read it fully before doing anything.
Last updated: 9 Oct 2026.

## Who and what
- User: Khush Mutha, co-founder and delivery lead at Oltaflock (AI agency). He is producing this for the client **PROMUNCH**, a high-protein snack brand. The client founder is **Parth**, and Khush sends him progress updates.
- Deliverable: a 3-episode AI-generated comedy series in 9:16 for Instagram Reels and YouTube Shorts, each episode 35–50s. Premium 3D animated-film look. PROMUNCH Edamame defeats the rival snacks (makhana, peanut, protein chips, protein bar) and is crowned "King of Protein Snacks".
- Other deliverables in the brief: an 8–10s launch teaser, a combined "Snack Smackdown" edit, clean and captioned versions, separate music and VO stems, thumbnails, and source files.

## How Khush wants Claude to work (important)
- **Ask before finalizing or locking anything.** Show options and wait for approval.
- **Always show generated images in the chat** (deliver them with the send-file tool), not just links.
- Replies in **English only**, concise and action-oriented. The script itself is Hindi/Hinglish.
- Be honest in reviews: flag anatomy errors (a "three arms" bug happened twice on Protein Bar), off-brand colours, and brand look-alikes.
- Mention credit spend for batches.

## Status
| Item | State |
|---|---|
| Hindi script (3 eps + teaser + brand frame) | Done, in Hinglish with Devanagari and Roman lines. `docs/hindi-script.pdf` / `.txt` |
| Character prompt library | Done. `docs/character-prompts.pdf` / `.txt` |
| Voices | Neutral Hindi accents (the user chose this over Lucknowi/Haryanvi). |
| Locked by user (stated 8 Oct) | Protein Bar, Peanut, Edamame. **Which Edamame form (tiny vs warrior) was not confirmed. Ask.** |
| Locked as Oltaflock elements (by Claude after approval) | See the table below |
| Makhana | Re-exploring. Options A/B/C in `images/options/makhana-*`. Claude recommends **A (Floating Nawab)**. Awaiting choice. |
| Protein Chips | Redesigned as a **square chip character** (not a pouch), no "PROTEIN" text anywhere, per user request. Options in `images/options/chip-A/B/C`. Claude recommends **A (Caped Hero)** as the base, with B/C as poses. Awaiting choice. |
| Edamame warrior form | Not right yet. v2/v3 in `images/wip/`. The head is too tall and pointy, and edits didn't fix it. Plan: generate fresh with the tiny bean as the only reference. |
| Character sheets | 10 done in `images/sheets/`. Makhana back view is weak, and the tiny bean's expressions are too similar. The Chips sheet is for the old pouch design. |
| Progress zip sent to Parth | Yes (1 Oct). |

## Pending script change
Chips no longer has PROTEIN written on him, so Ep 2 needs a new line. Proposed (not yet approved):
- CHIPS: "Mere naam mein hi protein hai!" / EDAMAME: "Naam rakhna aasaan hai… nibhaana mushkil."

## Claims and brand rules (hard)
- Protein badges on the packs: **Himalayan Rock Salt 46g; Indori Chatka 42g; Masala Mania 42g**. The script's Ep3 on-screen line "up to 45 g protein per 100 g" is WRONG and needs Parth's confirmation. Never put protein numbers inside generated images.
- PROMUNCH palette: maroon, cyan blue, sunny yellow, orange. Edamame armour is maroon and gold.
- Rival snacks must be generic, with no logos, names or recognisable pack designs. Avoid blue chip packets and red/yellow chip packets, which look like real brands.
- When the PROMUNCH pouch appears, use the real pack render as a reference. Pack renders are still needed from the client.
- No text in images except where intended.

## Tools and production stack
- **Oltaflock Studio MCP** (Khush's own studio) is the main generator. Model: `nano-banana-2` (text-to-image, refs allowed) and `nano-banana-2-edit` (image edit). 2K, 2:3 for hero poses and 16:9 for sheets. About 12 credits per image.
- Library folder: **"PROMUNCH - Protein Throne Characters"**, id `0ca195c3-5e38-450b-add4-afbefd22bd53`.
- Saved elements (use `@Name` in prompts): `@ProteinBar`, `@Makhana` (the user's original image), `@EdamameTiny`, `@Peanut`, `@ProteinChips` (OLD pouch design, likely superseded), `@Crown`, `@RoyalJudge`, `@HimalayanRockSalt`, `@MasalaMania`, `@IndoriChatka`.
- Uploading a local file to Studio: base64 is too token-heavy. The trick that worked: Higgsfield `media_upload` gives a presigned PUT URL, then curl PUT, then `media_confirm`, which returns a public URL. Pass that URL to Studio `studio_upload_media(url=...)`.
- For video, Khush likes **Seedance 2.0** (particle and morph effects). There is a `seedance2-director` skill.
- The `promunch-visual-prompts` skill holds the PROMUNCH product-photo visual DNA. Use it for pack and product shots.

## Key image URLs (Oltaflock CDN, base `https://cdn.oltaflock.ai/generations/4b898802-8bdc-4320-b849-8c596ffe8abe/`)
| Asset | File id (.png) |
|---|---|
| Edamame tiny (locked) | 06e01017-d8ee-453f-b82c-942e79cc9df7 |
| Edamame warrior v2 / v3 (WIP) | f6b7d840-126e-43c4-a0bc-0c20799938f7 / da920994-de92-459c-bbc0-8d633d468704 |
| Peanut (locked) | 104c761d-913a-4c98-b98d-0d4d7a987a4f |
| Protein Bar (locked, torn wrapper, 2 arms) | 3437fe1e-6c99-4487-b513-5644562fe78e |
| Crown | 2028e2f7-bb43-4389-9ed2-3a9051ad32d8 |
| Royal Judge (samosa) | 4b66e74f-c453-4d69-8bf2-dee22b69e8ef |
| Himalayan Rock Salt v2 | a029dcba-3341-4742-8162-a1901d68da75 |
| Masala Mania | 0bf68e48-82e4-44bc-a955-0768d1717027 |
| Indori Chatka | 2a7375b6-9f1d-4216-b9b7-90524b262491 |
| Makhana option A / B / C | 66b49c3c-bcef-4735-9764-670f61e77c1e / a097c8b3-58f4-4fda-9f70-d98fa2d59fe3 / 63e8cf67-6ead-4674-9320-8a4c90334a7d |
| Chip character A / B / C | 1571fef2-a5e1-44be-a397-875400403240 / 63407c2e-c454-4b70-ade1-3eae72c2460e / 086585f8-d964-4c31-a95e-83e11f2f3f5d |
| Makhana original (user's) | https://cdn.oltaflock.ai/uploads/4b898802-8bdc-4320-b849-8c596ffe8abe/1790787080333-makhana-original.png |

## Cast summary
- **PROMUNCH Edamame**: calm, deadpan, unbothered and extremely strong. Tiny cute bean form, then a towering warrior in maroon and gold armour with pod-shaped pauldrons. Thin maroon headband in both forms.
- **Makhana**: royal snob, so light he floats. Purple turban, pearls, fan, thin curled moustache (loses it in Ep 3; "Hawa Mantri" joke).
- **Peanut**: loud desi pehelwan with a langot, a red-check gamchha and a bushy handlebar moustache. Gets caught secretly eating PROMUNCH in Ep 3.
- **Protein Chips**: flashy show-off superhero chip with a magenta cape and mask.
- **Protein Bar**: joyless gym coach, huge upper body, tiny legs (skipped leg day), torn charcoal wrapper.
- Supporting cast: **Crown** (bored ruby eyes), **Royal Judge** (old samosa), and flavour warriors **Himalayan Rock Salt** (zen salt-crystal master), **Masala Mania** (fiery hothead) and **Indori Chatka** (cheeky street swagger).

## Agreed production plan (next steps)
1. Finish the Ep 1 cast: pick Makhana and Chips, then make sheets for the chosen designs.
2. Get the PROMUNCH pack renders from the client, then make a scale lineup of all characters.
3. Generate and lock the palace and arena locations.
4. Storyboard Ep 1 (15–18 shots of 2–3s each) for approval.
5. Keyframes per shot (approve), then image-to-video (Seedance 2.0).
6. Hindi VO per character, music, SFX, captions, final 9:16 edit. Then repeat for Eps 2–3, the teaser and the combined edit.

## Living docs (claude.ai, owned by the user)
- Hindi script: https://claude.ai/code/artifact/b541b002-8159-4ca5-8467-b1e91894dfc4
- Character prompts: https://claude.ai/code/artifact/6d9ca6dd-f2a5-451e-8598-fd95c86badb4

## Files in this pack
- `docs/`: script and prompt library (PDF + plain text)
- `images/locked/`: current approved hero images
- `images/sheets/`: turnaround and expression sheets
- `images/options/`: Makhana and Chips options awaiting a decision
- `images/wip/`: Edamame warrior attempts, the old pouch Chips design, and the chip-shape reference the user supplied
