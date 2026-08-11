-- Forge Master cloud profile storage
-- Run this once in the Supabase SQL editor for the project used by the app.

create table if not exists public.forge_master_cloud_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    profiles jsonb not null default '[]'::jsonb,
    active_profile_id text,
    updated_at timestamptz not null default now()
);

alter table public.forge_master_cloud_profiles enable row level security;

drop policy if exists "Forge Master users can read their own backup" on public.forge_master_cloud_profiles;
create policy "Forge Master users can read their own backup"
on public.forge_master_cloud_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Forge Master users can create their own backup" on public.forge_master_cloud_profiles;
create policy "Forge Master users can create their own backup"
on public.forge_master_cloud_profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Forge Master users can update their own backup" on public.forge_master_cloud_profiles;
create policy "Forge Master users can update their own backup"
on public.forge_master_cloud_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Forge Master users can delete their own backup" on public.forge_master_cloud_profiles;
create policy "Forge Master users can delete their own backup"
on public.forge_master_cloud_profiles
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.forge_master_cloud_profiles from anon;
grant select, insert, update, delete on table public.forge_master_cloud_profiles to authenticated;
