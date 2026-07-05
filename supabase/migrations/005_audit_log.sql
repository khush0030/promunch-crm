-- Audit log for destructive / sensitive actions (deletes, role changes,
-- integration re-auth). SaaS table-stakes: an after-the-fact record of WHO did
-- WHAT to WHICH entity, for accountability + any future compliance review.
--
-- Written only by server routes (service_role); readable by signed-in staff for
-- an in-app viewer. Never writable by anon/authenticated directly, so a row can
-- never be forged or deleted from the client.

create table if not exists audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_email  text,                       -- who did it (from the session)
  actor_id     uuid,                        -- their auth.users id, if known
  action       text not null,               -- e.g. 'contact.delete', 'team.role_change'
  entity_type  text,                        -- 'contact' | 'campaign' | 'kb_document' | ...
  entity_id    text,                        -- id of the affected row
  summary      text,                        -- one human-readable line for the viewer
  metadata     jsonb,                       -- structured extras (old value, reason, ...)
  ip           text,                        -- request IP, best-effort
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx on audit_log (created_at desc);
create index if not exists audit_log_entity_idx     on audit_log (entity_type, entity_id);
create index if not exists audit_log_actor_idx      on audit_log (actor_email);

alter table audit_log enable row level security;

-- No client writes/updates/deletes at all — inserts happen server-side with the
-- service_role key, which bypasses RLS. Append-only from the app's perspective.
revoke all on audit_log from anon;

-- Signed-in staff may READ the log (drives the in-app viewer). No insert/update/
-- delete policy exists, so authenticated users can only select.
drop policy if exists "audit_log authenticated read" on audit_log;
create policy "audit_log authenticated read"
  on audit_log for select
  to authenticated
  using (true);

grant select on audit_log to authenticated;
