-- Let "Find companies" control how many leads to scrape and whether to crawl
-- their sites for emails. max_results is per search row (one category x city);
-- the API splits the user's overall target across the searches it enqueues.
-- Apply via Supabase dashboard SQL editor.

alter table lead_searches add column if not exists max_results int;            -- null = Places hard max (60)
alter table lead_searches add column if not exists find_emails boolean not null default true;
