-- =========================================================================
-- Open Backup & Sync to everyone (end of the pre-release access gate for the
-- PERSONAL cloud). Until now has_app_access() = is_allowlisted(), so only
-- allowlisted testers (or training-group members, via may_use_cloud()) could
-- write personal cloud rows. Backup & Sync is now generally available: any
-- signed-in account may use the personal cloud.
--
-- Trainingsgruppe stays tester-gated: is_entitled() is UNCHANGED (still the
-- owner_allowlist), so creating/owning a group remains restricted. Joining and
-- leaving groups was never gated (join_with_code / membership delete), so invited
-- users keep working. may_use_cloud() and can_write() already OR through
-- has_app_access(), so redefining this ONE function opens personal writes for all
-- without touching the group branch.
-- =========================================================================
create or replace function fooseroo.has_app_access()
returns boolean language sql security definer stable set search_path = fooseroo as $$
  select auth.uid() is not null;
$$;

revoke all on function fooseroo.has_app_access() from public;
grant execute on function fooseroo.has_app_access() to authenticated;
