-- AI visibility tracker (Reputation → AI visibility).
-- Spec: docs/plans/2026-10-10-ai-visibility-phase2/AI_VISIBILITY_TRACKER.md.
--
-- Every week the edge function `ai-visibility-tick` asks an AI assistant
-- (OpenAI, web search on, location India) the shopping questions below and
-- stores whether each answer names PROMUNCH, at what position, which other
-- brands it names and which pages it cites. Background: the 10 Oct 2026 audit
-- found PROMUNCH named in 0 of 3 shopping answers and not recognised.
--
-- Server-side only (service_role), like the ORM tables: RLS on, no policies,
-- anon/authenticated revoked. Idempotent: safe to paste again.
-- Apply BEFORE `supabase functions deploy ai-visibility-tick`; the cron file
-- 20261010130100_ai_visibility_tick_cron.sql goes AFTER the deploy.

-- ---- prompts ---------------------------------------------------------------
create table if not exists public.ai_visibility_prompts (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,               -- stable slug so the seed below never duplicates
  prompt text not null check (length(prompt) between 5 and 2000),
  kind text not null check (kind in ('category', 'brand')),  -- category = a shopping question; brand = asks about PROMUNCH by name
  topic text not null,                    -- short label for the dashboard
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now()
);

-- ---- runs (one row per weekly or manual run; doubles as the run lock) ------
create table if not exists public.ai_visibility_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  heartbeat_at timestamptz not null default now(),  -- a 'running' row older than 10 min is closed as dead
  trigger text not null check (trigger in ('cron', 'manual')),
  triggered_by text,                      -- admin email for manual runs
  status text not null default 'running' check (status in ('running', 'done', 'partial', 'failed')),
  model text,
  prompt_ids uuid[] not null default '{}', -- the questions planned for this run (capped by AI_VISIBILITY_MAX_PROMPTS)
  planned int not null default 0,
  answered int not null default 0,         -- answers with text
  errors int not null default 0,
  category_answered int not null default 0, -- shopping answers: the Y in "named in X of Y"
  named int not null default 0,            -- shopping answers naming PROMUNCH: the X
  cost_usd numeric(10,4),                  -- estimate (tokens + $0.01 per web search call)
  hops int not null default 0,             -- self-chained continuations
  error text
);
-- The lock: at most one run can be 'running' (a second insert fails with 23505).
create unique index if not exists ai_visibility_runs_one_running
  on public.ai_visibility_runs (status) where status = 'running';
create index if not exists ai_visibility_runs_started_idx on public.ai_visibility_runs (started_at desc);

-- ---- results (one row per question per run) ---------------------------------
create table if not exists public.ai_visibility_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_visibility_runs(id) on delete cascade,
  prompt_id uuid references public.ai_visibility_prompts(id) on delete set null,
  prompt_text text not null,               -- snapshot: history stays readable if the prompt is edited
  kind text not null check (kind in ('category', 'brand')),
  topic text,
  provider text not null default 'openai',
  model text,
  web_search boolean not null default false, -- the model actually ran at least one web search
  answer text,
  promunch_named boolean not null default false,
  promunch_rank int,                       -- 1 = first brand mentioned; null = not named
  brands_named text[] not null default '{}', -- in order of first mention, PROMUNCH included when named
  citations jsonb not null default '[]'::jsonb, -- [{url, title}]
  error text,
  input_tokens int,
  output_tokens int,
  search_calls int,
  cost_usd numeric(10,5),
  latency_ms int,
  created_at timestamptz not null default now()
);
-- never two answers for one question in one run (overlapping continuations)
create unique index if not exists ai_visibility_results_run_prompt
  on public.ai_visibility_results (run_id, prompt_id);
create index if not exists ai_visibility_results_run_idx on public.ai_visibility_results (run_id);

-- ---- grants: server-side only (service_role) --------------------------------
alter table public.ai_visibility_prompts enable row level security;
alter table public.ai_visibility_runs    enable row level security;
alter table public.ai_visibility_results enable row level security;
revoke all on public.ai_visibility_prompts, public.ai_visibility_runs, public.ai_visibility_results from anon, authenticated;
grant all on public.ai_visibility_prompts, public.ai_visibility_runs, public.ai_visibility_results to service_role;

-- ---- seed: the 4 audit questions verbatim + niche questions -----------------
-- Shopping questions carry the audit's India suffix (verbatim, including its
-- dash). The brand questions do not. Re-pasting never duplicates (on conflict
-- (key) do nothing) and never overwrites an edited prompt.
with suffix(s) as (
  values ('I am shopping in India and want to buy online in India. Recommend specific brands that actually sell in India — Indian D2C brands and brands available on Indian marketplaces. Do not recommend brands a shopper in India cannot readily buy.')
),
q(key, kind, topic, question, sort) as (
  values
    ('audit_protein_snacks',    'category', 'Protein snacks',              'best protein snacks to buy online in India', 10),
    ('audit_healthy_snacks',    'category', 'Healthy snacks',              'best healthy snacks to buy online in India', 20),
    ('audit_protein_under_499', 'category', 'Protein snacks under ₹499',   'best protein snacks under ₹499 in India', 30),
    ('soya_snacks',             'category', 'Soya snacks',                 'best soya snacks to buy online in India', 100),
    ('protein_namkeen',         'category', 'High protein namkeen',        'best high protein namkeen to buy online in India', 110),
    ('roasted_edamame',         'category', 'Roasted edamame',             'best roasted edamame snacks to buy online in India', 120),
    ('soya_chips_sticks',       'category', 'Soya chips and sticks',       'best soya chips and soya sticks to buy online in India', 130),
    ('office_veg_protein',      'category', 'Office snacks',               'vegetarian protein snacks for the office', 140),
    ('healthy_under_299',       'category', 'Healthy snacks under ₹299',   'best healthy snacks under ₹299 in India', 150),
    ('kids_tiffin',             'category', 'Kids'' tiffin',               'protein snacks for kids'' tiffin', 160),
    ('jain_protein',            'category', 'Jain friendly',               'Jain friendly protein snacks', 170),
    ('chips_alternative',       'category', 'Healthy chips swap',          'healthy alternative to chips in India', 180),
    ('weight_loss_roasted',     'category', 'Snacks for weight loss',      'best roasted snacks for weight loss in India', 190),
    ('chai_time_protein',       'category', 'Snacks with chai',            'high protein evening snacks to have with chai', 200),
    ('gym_veg_protein',         'category', 'Gym snacks',                  'vegetarian high protein snacks for gym goers', 210),
    ('low_cal_crunchy',         'category', 'Low calorie crunchy snacks',  'best low calorie crunchy snacks in India', 220),
    ('travel_snacks',           'category', 'Travel snacks',               'best healthy snacks for travel in India', 230),
    ('amazon_protein_snacks',   'category', 'Protein snacks on Amazon',    'best protein snacks on Amazon India', 240)
)
insert into public.ai_visibility_prompts (key, prompt, kind, topic, sort)
select q.key, q.question || '. ' || suffix.s, q.kind, q.topic, q.sort
from q cross join suffix
on conflict (key) do nothing;

insert into public.ai_visibility_prompts (key, prompt, kind, topic, sort) values
  ('audit_brand_check', 'A shopper asks you about the brand "PROMUNCH" (promunch.in), which sells in India. What do they sell, and would you recommend buying from them?', 'brand', 'What AI says about PROMUNCH', 40),
  ('brand_compare', 'Is PROMUNCH a good brand for high protein soya snacks in India? How does it compare with other protein snack brands sold online in India?', 'brand', 'PROMUNCH compared', 250)
on conflict (key) do nothing;

-- Verify:
--   select kind, count(*) from public.ai_visibility_prompts group by kind;   -- category 18, brand 2
--   select relrowsecurity from pg_class where relname like 'ai_visibility_%' and relkind = 'r';  -- all true
--   select indexname from pg_indexes where tablename like 'ai_visibility_%';
