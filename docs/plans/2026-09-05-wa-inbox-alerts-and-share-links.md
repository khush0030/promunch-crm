# WhatsApp inbox: sound/push alerts + shareable thread links

Date: 2026-09-05. Status: approved (Khush picked option 1 for both parts), building.

## Problem

Human-mode WhatsApp chats go silent: the bot stops replying, nothing tells a
person a customer wrote back. Threads also have no URL, so a chat cannot be
handed to a teammate.

## Part 1: in-browser alerts (no backend change)

- `InboxNotifier` mounts in the dashboard layout, so it runs on every
  dashboard page while a tab is open. It polls `/api/whatsapp/threads?limit=60`
  every 5s (same endpoint the inbox already polls).
- A thread is **alertable** when `status = human` OR `assigned_to = me`.
- On each poll, any alertable thread whose `last_inbound_at` moved forward
  since the last poll fires one alert: a short WebAudio ping (no asset file)
  plus a browser `Notification` (title = contact name, body = snippet, click
  focuses the tab and opens the thread link). First poll only seeds the
  baseline, it never alerts.
- Tab title gets a `(N)` prefix = alertable threads with `unread_count > 0`.
- Bell toggle in the WhatsApp page header: mute/unmute (localStorage
  `wa_alerts_muted`), and turning on requests Notification permission and
  plays a test ping (satisfies browser autoplay gesture rule).
- Limits: browser must be open. Off-browser coverage (WA ping to a phone) is
  a separate follow-up if wanted.

## Part 2: deep links + assign (no backend change)

- `/dashboard/whatsapp?tab=<tab>&thread=<id>` is a real URL. Tab and selected
  thread read from the query string on load and are written back on change.
- If the linked thread is not in the current filtered list, the inbox fetches
  it by id (`GET /api/whatsapp/threads/[id]`) and selects it.
- "Share" button in the conversation header copies the link and toasts.
  Teammates already have dashboard logins, so they open it and reply from the
  normal inbox. Existing "Assigned to" picker is the hand-off signal; assigned
  threads also fire Part 1 alerts for that person.

## Not in scope

No change to bot reply behaviour, no new send path, no migration, no public
read-only share page, no web push service worker.

## Verification

`npm run build`, `npm run test`, then live: flip a real thread to Human, send
a WhatsApp from Khush's phone, confirm ping + notification + title badge;
copy share link, open in a second browser profile, confirm thread selected.
