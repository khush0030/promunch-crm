-- Influencer briefs: campaign hero product. When brief_focus is set, every
-- AI-written brief centres on that product (concept, hooks, script, talking
-- points) and its KB facts are fed to the model first. Owner set it to
-- Roasted Edamame on Oct 8 2026. Editable in Influencers → Settings.
alter table public.influencer_settings
  add column if not exists brief_focus text,
  add column if not exists brief_focus_notes text;

update public.influencer_settings
   set brief_focus = 'Roasted Edamame'
 where id = 1 and brief_focus is null;
