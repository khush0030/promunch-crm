-- B2B lead-gen pipeline: discovery (Google Places) + website crawl + contact verification.
-- Apply via Supabase dashboard SQL editor (CLI migration push not used for this project).

create table if not exists lead_searches (
  id uuid primary key default gen_random_uuid(),
  category text not null,                    -- e.g. 'corporate gifting company'
  city text not null,                        -- e.g. 'Mumbai'
  query text not null,                       -- full text query sent to Places
  status text not null default 'pending',    -- pending | running | done | error
  next_page_token text,
  pages_fetched int not null default 0,      -- Places caps at 3 pages (60 results)
  results_count int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, city)
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  place_id text unique not null,
  name text not null,
  website text,
  domain text,                               -- normalized hostname, no www
  address text,
  city text,
  category text,                             -- search category that found it
  types text[],
  site_snippet text,                         -- ~800 chars of about/home text for AI drafts
  status text not null default 'new',
  -- new | crawling | ready | no_contacts | no_website | drafting | drafted
  -- | contacted | replied | bounced | suppressed
  claimed_at timestamptz,
  crawl_attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_status_idx on leads (status, claimed_at);
create index if not exists leads_city_idx on leads (city);

create table if not exists lead_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  email text not null,                       -- lowercased
  source_url text,
  source text not null default 'regex',      -- mailto | regex | manual
  kind text not null default 'role',         -- role | personal
  role_hint text,                            -- info | sales | hr | admin | careers | ...
  verify_status text not null default 'unverified', -- unverified | mx_ok | mx_fail | syntax_fail
  confidence text not null default 'low',    -- high | medium | low
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (lead_id, email)
);
create index if not exists lead_contacts_lead_idx on lead_contacts (lead_id);
