-- ═══════════════════════════════════════════════════════════════════════════
-- 008 — Move team roles to app_metadata (2026-07-18 audit finding S3, HIGH)
--
-- Roles previously lived in auth user_metadata — which GoTrue lets ANY signed-
-- in user rewrite on themselves with the public anon key
-- (supabase.auth.updateUser({ data: { role: "admin" } })), i.e. member → admin
-- self-escalation. app_metadata can only be changed with the service-role
-- admin API, so it is the correct home.
--
-- Code side (same commit): src/lib/rbac.ts now reads app_metadata.role ONLY
-- and fails closed (no explicit owner/admin role => Member tier), with the
-- owner email always Admin as a lockout guard. The team route writes
-- app_metadata on invite + role change.
--
-- This backfill copies each user's current effective role into app_metadata.
-- Users with no stored role were historically treated as admin (the team was
-- flat full-access), so they backfill as 'admin' — preserving today's access
-- exactly while closing the escalation. Demote anyone you want to restrict
-- from the Team screen afterwards.
-- ═══════════════════════════════════════════════════════════════════════════

update auth.users
   set raw_app_meta_data =
         coalesce(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object(
              'role', coalesce(raw_user_meta_data->>'role', 'admin'))
 where deleted_at is null;

-- Verify:
--   select email,
--          raw_app_meta_data->>'role'  as app_role,
--          raw_user_meta_data->>'role' as legacy_role
--     from auth.users order by created_at;
