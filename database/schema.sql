-- Wahl v1 production schema for Supabase Postgres.
-- Public visitors can read public posts. Only explicitly registered owners can
-- read private drafts or modify the wall.
create extension if not exists "pgcrypto";

create table if not exists public.site_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 320),
  audience_type text not null check (audience_type in ('private', 'everyone')),
  created_at timestamptz not null default now()
);

create index if not exists idx_posts_created_at on public.posts (created_at desc);
alter table public.site_owners enable row level security;
alter table public.posts enable row level security;

create or replace function public.is_wahl_owner()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.site_owners where user_id = (select auth.uid()));
$$;

revoke all on function public.is_wahl_owner() from public;
grant execute on function public.is_wahl_owner() to anon, authenticated;
revoke all on public.site_owners from anon, authenticated;
revoke all on public.posts from anon, authenticated;
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;

drop policy if exists "Public posts are readable" on public.posts;
create policy "Public posts are readable" on public.posts for select to anon, authenticated
using (audience_type = 'everyone' or public.is_wahl_owner());

drop policy if exists "Owner can create posts" on public.posts;
create policy "Owner can create posts" on public.posts for insert to authenticated
with check (public.is_wahl_owner() and author_id = (select auth.uid()));

drop policy if exists "Owner can update posts" on public.posts;
create policy "Owner can update posts" on public.posts for update to authenticated
using (public.is_wahl_owner() and author_id = (select auth.uid()))
with check (public.is_wahl_owner() and author_id = (select auth.uid()));

drop policy if exists "Owner can delete posts" on public.posts;
create policy "Owner can delete posts" on public.posts for delete to authenticated
using (public.is_wahl_owner() and author_id = (select auth.uid()));

-- After signing in once, register the owner from the Supabase SQL editor:
-- insert into public.site_owners (user_id)
-- select id from auth.users where email = 'your-email@example.com';
