# PROMUNCH — n8n Order Confirmation Pipeline

Self-hosted n8n that owns the Shopify → WhatsApp order confirmation flow with full per-execution visibility, retries, and a sweep that recovers anything that slipped through.

```
Shopify orders/create
        │
        ▼
  ┌─────────────┐     ┌──────────────┐
  │  n8n        │ ──► │  wa-send     │ ──► Meta Cloud API
  │  (this)     │     │  edge fn     │
  └─────────────┘     └──────────────┘
        │                    │
        │                    ▼
        │             wa_messages (truth)
        ▼
   ┌─ on fail ─┐
   │ wa_jobs   │  ◄── 5-min sweep finds orders w/o confirmation
   │ retry     │      and enqueues them here too
   └───────────┘
        │
        ▼
  wa-jobs-tick (every 1 min) drains the queue
```

---

## 1. Provision the host

Any small VPS works (~€4/mo Hetzner CX22, Railway $5, Render, Lightsail). Requirements:

- Docker + docker-compose v2
- Open ports 80, 443
- A DNS A-record for `n8n.promunch.in` pointing at the VPS IP — **set this before first boot** so Caddy can fetch a Let's Encrypt cert.

One-liner Docker install (Debian/Ubuntu):
```bash
curl -fsSL https://get.docker.com | sh
```

---

## 2. Configure

```bash
cd /opt && git clone <this repo> promunch-crm
cd promunch-crm/n8n
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to get it |
|---|---|
| `N8N_HOST` | Your DNS name, e.g. `n8n.promunch.in` |
| `N8N_BASIC_AUTH_PASSWORD` | `openssl rand -base64 24` |
| `N8N_ENCRYPTION_KEY` | `openssl rand -hex 32` — **never rotate after first boot** (encrypts all credentials at rest) |
| `N8N_DB_*` | Supabase → Settings → Database → Connection string → Direct URI, split into parts |
| `SHOPIFY_WEBHOOK_SECRET` | Same value already in Supabase secrets |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `SLACK_ALERT_WEBHOOK_URL` | <https://api.slack.com/messaging/webhooks> (pick a channel) |

---

## 3. Boot

```bash
docker compose up -d
docker compose logs -f n8n   # wait until you see "Editor is now accessible"
```

Open `https://n8n.promunch.in` → log in with `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD`.

Owner-account screen appears on first run — set your real admin email + password (this is n8n's own user, separate from the basic-auth gate).

---

## 4. Create credentials inside n8n

In the editor, **Credentials → New**:

1. **Postgres** named exactly `Supabase Postgres`
   - Host, Port, Database, User, Password — same values as `.env`'s `N8N_DB_*` (Direct connection, not pooler)
   - SSL: **enable**, "Allow Unauthorized Certs" = ON
   - Click **Test** — must show green before saving.

That's the only credential the workflows need (they call wa-send via HTTP + the service role bearer pulled from `$env`).

---

## 5. Import the workflows

For each file in `./workflows/`:

```
Editor → ☰ → Import from File
   → workflows/order-confirmation.json
   → workflows/order-confirmation-sweep.json
```

After import, open each workflow → **Activate** toggle (top right).

The webhook URL appears on the first node:
```
https://n8n.promunch.in/webhook/shopify-order-confirmation
```

Copy it — you'll need it in step 6.

---

## 6. Wire Shopify → n8n (parallel run mode)

Shopify Admin → **Settings → Notifications → Webhooks → Create webhook**:

| Field | Value |
|---|---|
| Event | `Order creation` |
| Format | JSON |
| URL | `https://n8n.promunch.in/webhook/shopify-order-confirmation` |
| Webhook API version | latest stable |

> **Don't disable the existing Supabase webhook yet.** Run both in parallel for 24h to compare.

After saving, click **Send test notification** → check n8n's **Executions** tab — you should see a green run within a few seconds.

---

## 7. 24-hour parallel observation

Place a real test order. Confirm:

- ✅ Customer receives ONE WhatsApp confirmation (not two — the dedup on `wa_messages.sent_by` prevents the second).
- ✅ n8n Executions tab shows the run with all nodes green.
- ✅ Supabase `wa_messages` has the row with `sent_by = 'journey:order_confirmation:#XXXX'`.

Watch the Slack alert channel + n8n executions list over 24h. If counts match Supabase `connector_log` entries for `event='confirmation_sent'`, you're ready to cut over.

---

## 8. Cutover

Add a secret on Supabase to disable the legacy path:

```bash
supabase secrets set DISABLE_ORDER_CONFIRMATION_LEGACY=1 --project-ref <ref>
```

Then patch `shopify-wa/index.ts` `handleOrderCreate` to early-return when that env is `1` (a small follow-up commit). Or simpler: delete the legacy Shopify webhook subscription that points at `shopify-wa` while keeping the function deployed for `orders/fulfilled` + `checkouts/*` (those journeys haven't moved yet).

The shopify-wa edge function still handles:
- `orders/fulfilled` — shipping update
- `orders/cancelled` — stop pending journeys
- `checkouts/create` / `checkouts/update` — abandoned cart

→ keep those Shopify webhook subscriptions pointed at shopify-wa. Only the `orders/create` subscription moves to n8n.

---

## 9. Day-2 ops

**Re-trigger a single order** (cron sweep also catches it within 5 min):
```sql
INSERT INTO wa_jobs (kind, payload, run_after, max_attempts)
VALUES (
  'order_confirmation',
  jsonb_build_object(
    'wa_id', '91XXXXXXXXXX',
    'name', 'Khush',
    'order_ref', '#1981',
    'total', '650',
    'sent_by', 'journey:order_confirmation:#1981'
  ),
  NOW(), 8
);
```

**Inspect a failed execution** — n8n Executions tab → click the red one → every node shows input/output. Click the failed node → "Retry from this node" runs only that step with the captured input.

**Backfill orders from the last 24h** — run the sweep workflow manually (open it → "Execute Workflow") with the SQL window widened to `INTERVAL '24 hours'`.

**Pause everything** — toggle both workflows off in the editor. Shopify webhook keeps delivering (n8n returns 200 from the Respond node before any work) but no sends fire.

**Rotate the Shopify HMAC secret** — update in both Shopify admin and `.env`, then `docker compose up -d` (n8n re-reads env on restart).

---

## 10. Backup

n8n's state lives in two places:
- The Postgres schema `n8n` on your Supabase DB (workflows, credentials, executions) — backed up by Supabase automatically.
- `/var/lib/docker/volumes/n8n_n8n_data/` — encryption-key-derived material, binary execution data. Back up nightly:
  ```bash
  tar czf /backup/n8n-data-$(date +%F).tar.gz /var/lib/docker/volumes/n8n_n8n_data/
  ```

If you ever lose the `n8n_data` volume you can still restore from Postgres alone — credentials decrypt with `N8N_ENCRYPTION_KEY` from `.env`.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Caddy fails to get TLS cert | DNS not propagated, or port 80 blocked | `dig n8n.promunch.in` should show the VPS IP. Confirm firewall allows 80+443. |
| Editor loads but websocket disconnects every 30s | Reverse proxy missing the `flush_interval -1` | Verify Caddyfile, restart caddy |
| Workflow shows red "Unauthorized" on the Send via wa-send node | Service-role key wrong / quoted weirdly in .env | `docker compose exec n8n env \| grep SUPABASE` — confirm it's the long JWT (~250+ chars) |
| Verify-HMAC node always rejects | `SHOPIFY_WEBHOOK_SECRET` mismatch, OR Shopify webhook configured with form-data instead of JSON | Make sure webhook format = JSON in Shopify admin |
| `wa_jobs` rows accumulating with `status='pending'` and growing | wa-jobs-tick cron not running | `supabase functions schedule list \| grep wa-jobs-tick` — must be `* * * * *` |
| Duplicate confirmations after cutover | Both shopify-wa AND n8n still subscribed to `orders/create` | Delete the duplicate Shopify webhook subscription |
