# Instagram on PROMUNCH CRM — A Simple Guide

*Written for anyone on the team. No technical knowledge needed.*

---

## What this is, in one sentence

We connected our **PROMUNCH Instagram account** to our CRM dashboard, so that every DM and comment lands in one inbox, an AI assistant reads it, replies to simple questions automatically, and flags influencer collab offers for you to handle.

Think of it like **WhatsApp inbox you already use — but for Instagram.**

---

## Why we built it

Right now Instagram DMs are scattered and easy to miss. With this:

- **Customer questions** (price, flavours, delivery, "where do I buy?") get answered instantly, even at 2am.
- **Influencer collab requests** get caught, scored, and lined up for you — instead of getting lost.
- **Spam** gets filtered out so you never waste time on it.
- Everything sits in **one screen** inside the CRM you already log into.

---

## What you'll see in the dashboard

Go to the CRM → click **Instagram** in the sidebar. You'll see **5 tabs** along the top:

| Tab | What's in it |
|-----|--------------|
| **Inbox** | Every conversation, newest activity on top. A red number = unread messages. |
| **Collabs** | Influencer / creator offers. Sorted best-fit first (with a score out of 100). |
| **Needs human** | Anything the AI couldn't handle and passed to you (refunds, complaints, tricky asks). |
| **Spam** | Junk the AI filtered out. Glance occasionally, mostly ignore. |
| **Settings** | The control panel (see below). Usually set once and left alone. |

### Reading a conversation

Click any conversation to open it. You'll see:

- The person's **@handle** (click it to open their Instagram profile).
- A little **tag** showing what type it is: **Collab**, **Order/Q** (question), **Spam**, or **Unknown**.
- A badge: **"Bot is handling this"** or **"You're handling this."**
- The full chat history.
- A **reply box** at the bottom where you can type and hit **Send** any time.

---

## How it works (the simple version)

1. Someone DMs us or comments on a PROMUNCH post.
2. Within ~10 seconds it appears in the **Inbox**.
3. The AI reads it and decides what kind of message it is:
   - **A customer question?** → It answers automatically using our knowledge base (flavours, prices, shipping, etc.).
   - **A collab offer?** → It replies warmly, then **flags it for you** (and pings Slack).
   - **Spam?** → It stays silent and drops it in the Spam tab.
4. You can step in **at any moment** — type your own reply, or take a conversation over from the bot.

You're always in control. The bot is a helper, not a replacement.

---

## Handling influencer collabs (the fun part)

Open the **Collabs** tab. Each offer shows a **fit score out of 100** — higher = better match for us. The score is based on:

- Their **follower count** (we like the 20k–100k "micro-influencer" range).
- Their **engagement rate** (are people actually interacting with their posts?).
- How well their **niche matches** PROMUNCH (snacks, food, fitness, etc.).

Inside a collab conversation you get extra buttons:

- **Analyze & draft** — the AI pulls their stats and writes suggested barter terms for you. (Says **Re-analyze** if you've run it before.)
- **Suggested barter terms** box — the draft offer. Read it, then click **Use as reply** to drop it into the reply box. **Always review before sending.**
- **Stage buttons** — track where the deal is: *New → In convo → Terms sent → Agreed → Shipped → Posted → Declined.* Just click to move it along.
- **Take over** — switch the conversation from bot-handled to you-handled.

So a collab flows like: it lands → you click **Analyze & draft** → review the terms → **Use as reply** → send → move the stage as the deal progresses.

---

## The Settings tab (good to know, rarely touched)

This is the control panel. The important switches:

- **Paused** — the big OFF switch. Flip this and the bot stops auto-replying to everyone. Use if something looks wrong.
- **Auto-reply enabled** — turn the AI's automatic replies on or off.
- **Auto-reply scope** — "Routine only" (bot answers customer questions but just acknowledges collabs and leaves them for you) vs "All."
- **Auto-reply to comments** — whether the bot privately replies to comments on posts/reels.
- **Escalate to Slack** — sends collab offers to a Slack channel so you get notified.
- **Min / Max followers** — the influencer band we consider a good fit (default 20,000–100,000).
- **Barter terms** — the standard offer template the AI starts from when drafting collab terms.

> **Tip:** If you ever see the bot saying something odd, just flip **Paused** ON in Settings. It stops immediately. Then tell the dev team.

---

## ⚠️ Important: it's NOT live yet

The whole thing is **built and ready, but not switched on.** Before your team can use it, the dev side needs to:

1. **Get Meta's approval** — Instagram requires apps to be reviewed before they can read DMs and comments. This is a Meta process and can take a few days to a couple of weeks.
2. **Connect our Instagram account** — plug in the official account login/keys.
3. **Turn on the AI + Slack alerts** — wire up the assistant and pick a Slack channel for collab notifications.

Until those three are done, the Instagram tab will be empty. **This is a one-time setup by the dev/technical side, not something you do.**

### How you'll know it's ready

Once it's switched on, someone will test it by sending a DM to our PROMUNCH Instagram. Within ~10 seconds it should appear in the **Inbox**, with the AI either replying or flagging it. After that, it's open for the team.

---

## Quick cheat-sheet

- **Where:** CRM → **Instagram** in the sidebar.
- **Daily habit:** Check **Inbox** for unread (red numbers) and **Needs human** for anything passed to you.
- **Collabs:** Live in the **Collabs** tab, scored best-first. Use **Analyze & draft** → review → **Use as reply** → move the **Stage**.
- **You can always jump in:** type in the reply box and **Send**, or click **Take over.**
- **Emergency stop:** Settings → **Paused** ON.
- **Status today:** Built, waiting on Meta approval + setup. Not live yet.

---

*Questions? Ask the dev team. Full technical spec lives in `docs/instagram/instagram-influencer-pipeline.md`.*
