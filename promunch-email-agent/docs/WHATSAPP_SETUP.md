# WhatsApp + Knowledge Base — setup

Adds a WhatsApp inbox + AI customer-support agent + marketing/offer templates +
ticket management to the PROMUNCH CRM. All inbound/outbound traffic goes through
Meta WhatsApp Cloud API; the AI agent answers using a pgvector-backed knowledge
base.

## 1. Run the migration

```bash
supabase db push
```

Creates: `wa_contacts`, `wa_threads`, `wa_messages`, `wa_templates`,
`wa_campaigns`, `kb_documents`, `kb_chunks`, plus `match_kb_chunks()` RPC and
the `vector` extension.

## 2. Create the Storage bucket for KB uploads

In Supabase dashboard → Storage → New bucket:

- Name: `kb-docs`
- Private (do NOT make public)

## 3. Set secrets

Append to `.env`, then:

```bash
supabase secrets set --env-file .env
```

Required new vars (see `.env.example`):

- `OPENAI_API_KEY` — for embeddings (text-embedding-3-small, 1536 dims)
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ACCESS_TOKEN` (permanent System User token)
- `WHATSAPP_VERIFY_TOKEN` (you pick — random string)
- `WHATSAPP_APP_SECRET` (Meta app secret)
- `WHATSAPP_GRAPH_VERSION` (optional, defaults v21.0)
- `KB_BUCKET` (defaults `kb-docs`)

## 4. Deploy the new edge functions

```bash
supabase functions deploy wa-webhook
supabase functions deploy wa-send
supabase functions deploy wa-ai-reply
supabase functions deploy kb-ingest
```

## 5. Configure the Meta webhook

In Meta App Dashboard → WhatsApp → Configuration:

- **Callback URL:** `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/wa-webhook`
- **Verify Token:** the same string you set as `WHATSAPP_VERIFY_TOKEN`

Subscribe to fields: `messages` (required), `message_template_status_update` (optional).

## 6. Upload knowledge base

Open `/dashboard/whatsapp`, switch to the **Knowledge Base** tab, and either:

- Upload PDFs (return policy, FAQ, product specs)
- Paste text directly

Each doc is chunked (~800 tokens, 100-token overlap), embedded, and stored in
`kb_chunks`. Status flips to `ready` when ingestion finishes.

## 7. Test the loop

Send a WhatsApp message to the sandbox/production number. You should see:

1. A new row in `wa_contacts` + `wa_threads`.
2. The inbound message appears in the Inbox tab within a few seconds.
3. If thread status is `bot` and the question is answerable from the KB, the
   AI replies automatically and the outbound message shows up with an "AI" badge.
4. If the AI escalates, thread flips to `human`, a ticket opens with priority +
   category, and (if `SLACK_WEBHOOK_URL` is set) a Slack alert fires.

## 8. Sending templates from the dashboard

In **Templates** tab, create a template. To go live, submit it for approval in
Meta Business Manager and flip its status to `approved` here (or sync via the
Graph API — TODO). Then in the Inbox, click **Template** in any conversation
to send.

## 9. Tickets

Tickets are not a separate table — they live on `wa_threads`:

- `ticket_status` (none | open | pending | resolved | closed)
- `ticket_priority` (low | normal | high | urgent)
- `ticket_category`, `ticket_subject`, `ticket_assignee`
- `ticket_number` (auto-incrementing, human-friendly)

The AI agent opens a ticket automatically on escalation; agents can flip status
from the conversation header.
