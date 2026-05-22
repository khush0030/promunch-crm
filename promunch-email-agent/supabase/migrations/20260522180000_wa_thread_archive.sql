-- Archive a WhatsApp thread: hide it from the dashboard inbox WITHOUT deleting
-- any messages. archived_at NULL = active (shown); non-null = archived (hidden).
-- A new inbound message clears archived_at (wa-webhook) so the chat resurfaces.

alter table wa_threads
  add column if not exists archived_at timestamptz;

create index if not exists wa_threads_archived_idx
  on wa_threads (archived_at);
