# 03 · Screen inventory (current app → redesign)

Source: every `page.tsx` under `src/app/` in the main worktree on 7 Oct 2026 (55 files), tab state found by grepping `tab ===`, `{ key, label }` tab arrays and `?tab=`, and every modal / drawer / dialog component (`ConfirmDialog`, `*Modal`, `*Drawer`, `*Dialog`, `MoreSheet`, `CommandPalette`, `Toast`).

Legend for **Decision**: **Keep** = same job, redesigned · **Merge** = folded into another destination · **Move** = lives somewhere else now · **Retire** = removed from navigation, URL redirects · **Redirect** = already a redirect today, keeps redirecting to the new home.

Prototype anchors are `file#screen` (screens) or `file#screen/overlay` (pop-ups). Open them directly, or use **All screens** in the prototype's top strip.

## A. Dashboard routes

| Area | Current route | Tabs today | Modals / drawers today | Decision → new home | Prototype |
|---|---|---|---|---|---|
| Home | `/dashboard` | none | Onboarding welcome modal + sidebar spotlight | Keep → **Home · Today** | `index.html#home`, `#home/welcome`, empty state `#home-clear` |
| Home | `/dashboard/attention` | Money at risk · Customers waiting · Marketing; Open / Snoozed / Done | snooze | Keep → **Home · Needs you** | `index.html#attention`, `#attention/snooze` |
| Maya | `/dashboard/assistant` | none | ToolResult cards | Keep → **Ask Maya** (pinned yellow button) | `maya.html#maya-home`, `#maya-chat`, `#maya-thinking`, `#maya-saved`, `#maya-chat/save-ans`, `#maya-chat/sources` |
| Sales | `/dashboard/sales` | none (period picker) | none | Move → **Insights · Sales** | `analytics.html#an-overview` |
| Sales | `/dashboard/sales/web` | none | none | Move → **Insights · Website** | `analytics.html#an-web` |
| Sales | `/dashboard/sales/amazon` | Overview · Stock · Profit · Payouts · Orders | add cost (inline) | Move → **Insights · Amazon** (one page, sections instead of 5 tabs; Amazon orders in Orders → All orders) | `analytics.html#an-amazon`, `#an-amazon/sku`, `#an-amazon/stock-plan`, `#an-amazon/add-cost` |
| Sales | `/dashboard/sales/orders` | Needs a call · All orders · Confirmation coverage | ConfirmDialog (cancel / confirm), "How confirmations work" | Keep → **Orders & COD** (Confirm COD · Voice calls · All orders · Call rules) | `cod-voice.html#or-today`, `#or-all`, `#or-all/order`, `#or-today/manual-confirm`, `#or-today/cod-cancel` |
| Sales | `/dashboard/analytics` (email analytics) | none | none | Merge → **Email · Results** | `email.html#em-results` |
| Inbox | `/dashboard/inbox` | Needs a human · Mine · Bot · All | TemplatePicker, image attach, ConfirmDialog | Keep → **Inbox · Live chats** | `tickets.html#tk-chats` |
| Inbox | `/dashboard/inbox/[id]` | (deep link) | same as above | Keep → deep link into Live chats / Ticket | `tickets.html#tk-chats`, `#tk-ticket` |
| Inbox | `/dashboard/inbox/tickets` | Open · Waiting on customer · Resolved this week | ConfirmDialog | Keep, rebuilt as **helpdesk** (views, 6 statuses, priority, SLA, assignment, notes, saved replies, tags, merge, escalate, CSAT) | `tickets.html#tk-queue`, `#tk-ticket`, `#tk-ticket/macros`, `#tk-ticket/merge`, `#tk-ticket/escalate`, `#tk-ticket/solve`, `#tk-queue/new-ticket`, `#tk-queue/tk-settings-dr`, `#tk-reports` |
| Inbox | `/dashboard/inbox/email` | To approve · Needs attention · Sent · Skipped · No reply | ConfirmDialog "Skip this email?" | Keep → **Inbox · Email drafts** | `tickets.html#tk-drafts`, `#tk-drafts/skip-draft` |
| Inbox | `/dashboard/support-emails` | Pending · Sent · Skipped · Failed | none | Merge → **Inbox · Email drafts** (old URL redirects) | `tickets.html#tk-drafts` |
| Inbox | `/dashboard/support-emails/[id]` | none | none | Merge → Email draft detail pane | `tickets.html#tk-drafts` |
| WhatsApp | `/dashboard/whatsapp` | Start here · Campaigns · Message templates · Automations · Results · Signup popup · Voice · Bot knowledge (8) | KbView ManualKbModal, GrowthView ConfirmDialog, AudienceInsights import confirm | Keep, cut to **5 tabs**: Overview · Campaigns · Templates · Automations · Results. Signup popup → Customers. Voice → Orders. Bot knowledge → Inbox. Audience insights → Customers · Segments + campaign wizard | `whatsapp.html#wa-home`, `#wa-campaigns`, `#wa-templates`, `#wa-flows`, `#wa-results` |
| WhatsApp | `/dashboard/whatsapp/campaigns` | redirect | | Redirect → Campaigns | `whatsapp.html#wa-campaigns`, empty state `#wa-campaigns-empty` |
| WhatsApp | `/dashboard/whatsapp/campaigns/new` | wizard steps (audience modes: segment / tags / retarget / csv / everyone) | ConfirmDialog (leave, follow-up, can't edit) | Keep → 4-step wizard | `whatsapp.html#wa-new`, `#wa-new/test-send`, `#wa-new/launch` |
| WhatsApp | `/dashboard/whatsapp/campaigns/[id]` | detail (funnel, journey, follow-ups) | FollowupDrawer, useCampaignActions ConfirmDialogs | Keep → Campaign report | `whatsapp.html#wa-report`, `#wa-report/followup`, `#wa-report/pause`, `#wa-report/cancel-camp` |
| WhatsApp | `/dashboard/whatsapp/campaigns/[id]/edit` | wizard | same | Merge → wizard in edit mode | `whatsapp.html#wa-new` |
| WhatsApp | (Templates tab) | starter / write / check / send | TemplateCreator close + unfinished-work confirms, DeleteTemplateDialog | Keep → Template creator | `whatsapp.html#wa-template-new`, `#wa-template-new/tpl-submit` |
| WhatsApp | (Automations tab) | list → custom flow builder, recipe gallery, Marketing / Order sections | AutomationsView ConfirmDialog | Keep → Automations + detail | `whatsapp.html#wa-flows`, `#wa-flow`, `#wa-flows/recipes`, `#wa-flow/edit-step` |
| Email | `/dashboard/email` | Home · Campaigns · Templates · Audiences · Automations · Brand & settings (6) | none | Keep → **Email**, 5 tabs; Audiences → Customers · Segments; Brand → Settings | `email.html#em-home` |
| Email | `/dashboard/email/campaigns` | All · Drafts · Needs approval · Scheduled · Sent | ConfirmDialog (not set up) | Keep | `email.html#em-campaigns` |
| Email | `/dashboard/email/campaigns/[id]` | steps email → audience → review → send; approval states | ConfirmDialog (rejected, waiting, can't send, old HTML) | Keep → 4-step builder with approval | `email.html#em-builder`, `#em-builder/em-test`, `#em-builder/em-ai`, `#em-builder/em-approve`, `#em-builder/em-reject`, report `#em-report` |
| Email | `/dashboard/email/automations` | none | ConfirmDialog | Keep | `email.html#em-flows` |
| Email | `/dashboard/email/automations/[id]` | Edit · Preview | ConfirmDialog "This automation is live" | Keep → detail with click-to-edit drawer | `email.html#em-flow`, `#em-flow/em-edit`, `#em-flow/em-pause` |
| Email | `/dashboard/email/templates` | none | ConfirmDialog, template preview | Keep | `email.html#em-templates` |
| Email | `/dashboard/email/templates/[id]` | none (VisualEmailEditor) | none | Keep → editor | `email.html#em-template-edit` |
| Email | `/dashboard/email/audiences` | none | ConfirmDialog | Merge → **Customers · Segments** | `other.html#cu-segments`, `#cu-segments/seg-new` |
| Email | `/dashboard/email/settings` | colour keys | none | Move → **Settings · Brand & email** | `other.html#set-brand` |
| Email (Brevo) | `/dashboard/marketing/email` | Campaigns · Reports · Automations · Audience · Coupons · SMS · Health (7) | CampaignActions (4 confirms), Coupons, SMS, Audience, Automations dialogs | **Retire** → redirect to Email | `other.html#retired` |
| Email (Brevo) | `/dashboard/marketing/email/new`, `/[id]`, `/[id]/edit` | editor | CampaignActions | **Retire** → Email | `other.html#retired` |
| Email (legacy) | `/dashboard/campaigns`, `/campaigns/new`, `/campaigns/[id]` | sort chips; segment select | none | **Retire** → Email · Campaigns · Sent (read-only history) | `other.html#retired` |
| Email (legacy) | `/dashboard/flows`, `/flows/new`, `/flows/[id]` | redirects today | | Redirect → Email · Automations | `email.html#em-flows` |
| Customers | `/dashboard/contacts` | filter chips (days, min orders, LTV), CSV export | none | Keep → **Customers** | `other.html#cu-list`, `#cu-list/import`, `#cu-list/new-contact` |
| Customers | `/dashboard/contacts/[id]` | Orders · Activity · Audience panels | deactivate | Keep → Customer profile (+ GDPR delete) | `other.html#cu-profile`, `#cu-profile/anonymize` |
| Customers | (WhatsApp Signup popup tab) | Popup · Chat button | ConfirmDialog, PositionPicker | Move → **Customers · Sign-up popup** | `other.html#cu-popup` |
| B2B | `/dashboard/leads` | Lists · Sequences · Templates · Replies · Analytics (+ scrapes / review) | SearchModal, LeadModal, ListPickerModal, SettingsModal, GuideModal, ConfirmModal, TextPromptModal, AiDraftModal, CampaignWizard | Keep, rebuilt as **Find → Review → Send → Track**; lists / sequences / templates / settings → one Setup page | `b2b.html#b2b-home`, `#b2b-find`, `#b2b-review`, `#b2b-review/b2b-send`, `#b2b-review/b2b-rewrite`, `#b2b-track`, `#b2b-setup` |
| Deals | `/dashboard/deals` | Board · List; Closed column | DealDrawer | Merge → **B2B & deals · Deals** | `b2b.html#b2b-deals`, `#b2b-deals/deal`, `#b2b-deals/new-deal` |
| Creators | `/dashboard/influencers` | Board · Creators · Kits · Settings | AddCollabDrawer, DealDrawer (Brief, Checklist, Drafts, Hooks, Timeline, Reminders), CreatorDrawer, Kits/Settings ConfirmDialogs (approve draft, create Shopify order, mark delivered, start sending) | Keep → **Creators desk** | `influencers.html#inf-board`, `#inf-board/add`, `#inf-board/ship`, `#inf-deal`, `#inf-deal/approve-draft`, `#inf-deal/changes`, `#inf-deal/brief`, `#inf-deal/ghost`, `#inf-creators`, `#inf-creators/creator`, `#inf-kits`, `#inf-kits/kit-new`, `#inf-settings`, `#inf-settings/engine-on` |
| Instagram | `/dashboard/instagram` | Inbox · Collabs · Discovery · Tasks · Needs human · Spam · Settings (7) | PitchQueue, Discovery select-all | **Retire** for now (backend not migrated, redirect exists). DMs return as an Inbox channel; Discovery folds into Creators | `other.html#retired`, Inbox channel shown as "off" in `tickets.html#tk-chats` |
| Settings | `/dashboard/settings` | Connections · API keys · Email · Brand · Team | AccessDialog | Keep → **Settings** (Connections · Team & access · API keys · Brand & email · Security) | `other.html#set-home`, `#set-team`, `#set-team/access`, `#set-team/invite`, `#set-keys`, `#set-keys/rotate`, `#set-brand`, `#set-home/notif-settings` |
| Settings | `/dashboard/team` | redirect | | Redirect → Settings · Team & access | `other.html#set-team` |
| Settings | `/dashboard/integrations` | redirect | | Redirect → Settings · Connections | `other.html#set-home` |
| Admin | `/dashboard/admin` | People · Live sessions · Activity log | none | Move → **Settings · Security** (admins only) | `other.html#set-security`, `#set-security/signout` |
| Admin | `/dashboard/audit-log` | redirect | | Redirect → Settings · Security · Activity log | `other.html#set-security` |
| System | `/dashboard/no-access` | none | | Keep | `other.html#no-access` |
| Orders | (WhatsApp Voice tab, `VoiceView`) | none | none | Move → **Orders · Voice calls + Call rules** | `cod-voice.html#or-calls`, `#or-calls/call`, `#or-settings` |
| Inbox | (WhatsApp Bot knowledge tab, `KbView`) | none | ManualKbModal, delete ConfirmDialog | Move → **Inbox · Bot knowledge** | `tickets.html#tk-kb`, `#tk-kb/kb-add`, `#tk-kb/kb-test` |

## B. Public and auth routes

| Current route | What it is | Decision | Prototype |
|---|---|---|---|
| `/` (`src/app/page.tsx`) | Redirects to dashboard / login | Keep | (no UI) |
| `/login` | Sign in | Keep, rebranded | `public.html#login` |
| `/auth/set-password` | Invite password page | Keep | `public.html#set-password` |
| `/u/[token]` | Email unsubscribe confirmation | Keep | `public.html#unsub` |
| `/r/[code]` (route handler) | WhatsApp short-link click redirect | Keep (no UI; slow-redirect fallback designed) | `public.html#short-link` |
| `/c/[code]` | Creator portal | Keep, mobile-first, 4 states + request change | `portal.html#pt-brief`, `#pt-box`, `#pt-draft`, `#pt-done`, `#pt-brief/pt-change` |
| `/brief/[code]` (spec §4A, not built) | Hosted brief | Merge into `/c/[code]` step 1 | `portal.html#pt-brief` |
| 404 / errors | Next.js defaults | New branded 404 + shared error / stale / loading patterns | `public.html#not-found`, `other.html#error` |

## C. Global UI elements

| Element | Today | Redesign | Prototype |
|---|---|---|---|
| Sidebar | 6 hubs, ~16 visible + 10 hidden items, dark | 8 items, 3 groups, light, collapsible rail | every page; `system.html` Navigation |
| Phone tab bar + More sheet (`TabBar.tsx`, `MoreSheet`) | 5 hubs | Home · Inbox · Maya · Orders · More | every page at 390px; `index.html#home/more` |
| Command palette (`CommandPalette.tsx`) | ⌘K jump | ⌘K search across orders, customers, tickets, pages | `index.html#home/palette` |
| Top bar (`TopBar.tsx`) | phone only | Search + notifications on laptop and phone | every page |
| Notifications | sound + browser notifications (`InboxNotifier`) | Bell drawer + per-person settings | `index.html#home/notif`, `other.html#set-home/notif-settings` |
| Toasts (`ui/Toast.tsx`, ~104 call sites) | varied | One dark toast, optional Undo | any `data-toast` button; `system.html` Feedback |
| ConfirmDialog (`pm/ConfirmDialog.tsx`, ~40 uses) | many styles | One modal pattern, destructive in red outline | e.g. `whatsapp.html#wa-report/cancel-camp` |
| Empty states (`pm/EmptyState.tsx`) | icon + text | Big caps headline, sticker, one CTA | `whatsapp.html#wa-campaigns-empty`, `index.html#home-clear` |
| SessionGuard / ConnectorBanner | banners | Stale-data callout pattern | `other.html#error` |
| Guide kit (`components/guide/*`: HelpTip, GlossaryTerm, Popover, Checklist, RecipeCard, StepHeader, NextStepCallout, PlainSummary, FlowTimeline) | lots of explanatory chrome | Kept as behaviour: plain summaries, steppers, recipe gallery, timelines. Removed: glossary underlines and "?" tips | throughout |

## Coverage
- Current `page.tsx` files: **55** (50 under `/dashboard`, 5 public/auth incl. root `/`). **All 55 are mapped** in sections A and B, each with an explicit Keep / Merge / Move / Retire / Redirect decision. Also re-homed: 3 tab-level modules (Voice, Bot knowledge, Signup popup) and the `/r/[code]` route handler.
- Prototype: **73 screens + 60 pop-ups / drawers / sheets** (plus the design system page and the phone-frames page) (see `manifest.js`; global palette, notifications and More sheet included).
- Nothing left unmapped. Items not drawn pixel-for-pixel but covered by a shared pattern: Instagram's 7 tabs (retired), Brevo's 7 tabs (retired), legacy email pages (retired), individual "couldn't load" dialogs (one error pattern), Leads Analytics (folded into Overview + Sent & replies counts).
