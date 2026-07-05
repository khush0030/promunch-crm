-- Owner-managed API keys for the dashboard (Settings → API keys).
-- Values are readable by service_role only; the Next.js app reads them through
-- getSecret() with env-var fallback, so applying this migration changes nothing
-- until a key is saved from the dashboard.
-- Apply via the Supabase dashboard SQL editor.

create table if not exists app_secrets (
  name text primary key,
  value text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table app_secrets enable row level security;
revoke all on app_secrets from anon, authenticated;
