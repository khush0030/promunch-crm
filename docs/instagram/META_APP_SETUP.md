# Meta Developers — App Setup for the PROMUNCH Instagram Pipeline

Everything to do on [developers.facebook.com](https://developers.facebook.com) to take the
Instagram stack (inbox bot + collab CRM + follow-up engine) live. The Discovery tab does NOT
need any of this — it runs on Apify and works today.

What the app must be able to do:
1. Receive DMs + comments as webhooks (`ig-webhook`)
2. Send DMs inside the 24h window (`ig-send`)
3. Send DMs in the 24h–7d lane with the HUMAN_AGENT tag (Tasks-tab approvals)
4. Read public creator metrics via Business Discovery (`ig-analyze`)

---

## 0. Prerequisites (before touching the developer site)

- [ ] The PROMUNCH Instagram account is a **Professional (Business) account**
      (Instagram app → Settings → Account type). Creator type also works but Business is cleaner.
- [ ] The IG account is **linked to a Facebook Page** you admin
      (Instagram app → Edit profile → Page, or Meta Business Suite → Settings → Instagram).
      The Graph API for messaging only works through a Page-linked IG Business account.
- [ ] Access to **Meta Business Suite / Business Manager** (business.facebook.com) for the
      business that owns the Page. You will create a **system user** there for the permanent token.

## 1. Create the app

1. developers.facebook.com → **My Apps → Create App**.
2. Use case: choose **"Other"** → app type **Business**. (Do NOT pick the consumer
   "Instagram API with Instagram Login" basic-display style flow — messaging needs a Business
   app connected to the Page.)
3. Name it (e.g. `PROMUNCH CRM`), set the contact email, link it to the PROMUNCH Business
   Manager account when asked.
4. From the app dashboard, **Add product → Messenger** (this is where Instagram messaging
   settings live) and **Add product → Webhooks**.

## 2. App settings you will need in Supabase

App dashboard → Settings → Basic:

| Meta value | Supabase secret |
|---|---|
| App Secret | `INSTAGRAM_APP_SECRET` (webhook signature check) |
| — (you invent it) | `INSTAGRAM_VERIFY_TOKEN` (any random string, e.g. `openssl rand -hex 16`) |
| IG Business account id (step 4) | `INSTAGRAM_USER_ID` |
| System-user token (step 5) | `INSTAGRAM_ACCESS_TOKEN` |

Set them with `supabase secrets set KEY=value` from `promunch-email-agent/`.

## 3. Webhooks (Instagram object)

App dashboard → **Webhooks → Instagram** (or Messenger → Instagram settings → webhooks):

1. Callback URL: `https://hlykspakpewuilttnydm.supabase.co/functions/v1/ig-webhook`
2. Verify token: the exact `INSTAGRAM_VERIFY_TOKEN` value you set in Supabase.
   (Deploy `ig-webhook` FIRST — Meta hits it with a GET challenge on save.)
3. Subscribe to fields: **`messages`**, **`comments`**. (`messaging_postbacks` optional;
   we don't use buttons today.)
4. Then subscribe the actual IG account to the app: Messenger product → Instagram settings →
   connect the PROMUNCH Page/IG account. (API alternative:
   `POST /<IG_USER_ID>/subscribed_apps?subscribed_fields=messages,comments`.)

## 4. Find the IG Business account id

Graph Explorer (developers.facebook.com/tools/explorer), with your Page selected:
`GET me/accounts` → note the Page id → `GET <PAGE_ID>?fields=instagram_business_account`
→ the returned id is `INSTAGRAM_USER_ID`.

## 5. Permanent token via a system user (do NOT use a short-lived user token)

The WhatsApp channel already burned once on an expiring token (see
[[wa-access-token-rotation]]). Same rule here:

1. business.facebook.com → Business settings → Users → **System users** → create
   (name: `promunch-crm-bot`, role: Admin).
2. **Add assets**: give it the Facebook Page (full control) — the linked IG account rides along.
3. **Generate new token**: pick this app, token expiration **Never**, scopes:
   - `instagram_basic`
   - `instagram_manage_messages`
   - `instagram_manage_comments`
   - `pages_manage_metadata`
   - `pages_read_engagement`
   - `business_management`
4. Save the token as `INSTAGRAM_ACCESS_TOKEN`. It also covers Business Discovery reads.

## 6. App Review (the long pole — file everything in ONE submission)

While the app is in **Development mode**, everything works but ONLY for users with a role on the
app (add your own IG account as a tester: App roles → Roles → add people, accept the invite in
IG → Settings → Website permissions → Apps). Real customer/creator DMs need **Live mode**, which
needs Advanced Access approvals:

Request Advanced Access for:
- [ ] `instagram_manage_messages` — the inbox bot + follow-ups
- [ ] `instagram_manage_comments` — comment capture + private replies
- [ ] `instagram_basic`
- [ ] **`Human Agent`** (listed under App Review → Permissions and features as
      "human_agent") — the 24h–7d approval lane in the Tasks tab. This is a SEPARATE approval;
      file it in the same submission. Until granted, keep
      `ig_settings.human_agent_enabled=false` (the default) — the engine degrades gracefully
      (24h auto-send + email/WhatsApp/manual fallbacks still work).

Submission needs, per permission:
- A **screencast** of the real flow (screen-record the dashboard: an inbound test DM arriving,
  the bot replying from the KB, a human approving a follow-up in the Tasks tab). Meta reviewers
  reject vague or mocked footage — record against the live dev-mode app.
- A written description of the use case. Honest one-liner that matches what they'll see:
  "PROMUNCH's CRM receives Instagram DMs/comments from customers and creator partners, answers
  routine questions with templated/KB answers, and lets our team reply and send human-approved
  follow-ups about ongoing collaborations."
  For Human Agent specifically: "Our support/partnerships team replies to conversations that
  need a human within 7 days of the customer's last message."
- Business verification of the PROMUNCH business in Business Manager (Settings → Security
  centre) — usually required for Advanced Access; start it early, it can take days.
- Privacy policy URL + data-deletion instructions URL on the app (Settings → Basic). Point at
  trypromunch.in pages.

Timeline: expect 1–3 weeks, sometimes a rejection asking for a clearer screencast. Nothing else
in the stack blocks on it — keep using dev mode with tester accounts for the end-to-end smoke.

## 7. After approval — go-live order

Follow Phase C in the main plan (docs/instagram/instagram-influencer-pipeline.md):
secrets → migrations (`ig_discovery` if not applied, `ig_followups`) →
`supabase functions deploy ig-webhook ig-send ig-ai-reply ig-analyze ig-jobs-tick
ig-followup-tick ig-discovery ig-discovery-tick` → cron migration `20260721141000` →
webhook subscribe check → `vercel --prod` → smoke test with a tester IG account →
flip `ig_settings.followups_enabled=true`. Flip `human_agent_enabled=true` only when the
Human Agent permission shows **Advanced Access: granted**.

## 8. Gotchas

- **Webhook save fails** → `ig-webhook` not deployed yet, or verify token mismatch.
- **Sends fail with OAuth error code 190/1** → token expired or wrong scopes; regenerate the
  system-user token with expiration Never (same failure mode as WhatsApp).
- **`(#10) This message is sent outside of allowed window`** → expected; that's the window the
  guard + Tasks tab exist for. If it appears on an in-window send, the thread's
  `last_inbound_at` is stale (comment-only threads never open the DM window).
- **Business Discovery returns nothing** → the target account is private or not a
  Professional account; scoring degrades gracefully.
- **Dev mode silence** → the sender has no role on the app; add them as a tester or go Live.
