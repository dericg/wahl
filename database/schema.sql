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
  -- Plain text with optional **bold** / *italic* markers; the limit includes
  -- formatting. The client renders text safely, never stored HTML.
  text text not null check (char_length(text) between 1 and 320),
  audience_type text not null check (audience_type in ('private', 'everyone')),
  created_at timestamptz not null default now()
);

create table if not exists public.automation_requests (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'working', 'pr_ready', 'no_change', 'failed', 'closed')),
  pull_request_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_posts_created_at on public.posts (created_at desc);
alter table public.site_owners enable row level security;
alter table public.posts enable row level security;
alter table public.automation_requests enable row level security;

create or replace function public.is_wahl_owner()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.site_owners where user_id = (select auth.uid()));
$$;

revoke all on function public.is_wahl_owner() from public;
grant execute on function public.is_wahl_owner() to anon, authenticated;
revoke all on public.site_owners from anon, authenticated;
revoke all on public.posts from anon, authenticated;
revoke all on public.automation_requests from anon, authenticated;
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;
grant select on public.automation_requests to authenticated;
grant insert on public.automation_requests to authenticated;

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

drop policy if exists "Owner can read automation requests" on public.automation_requests;
create policy "Owner can read automation requests" on public.automation_requests for select to authenticated
using (public.is_wahl_owner() and requested_by = (select auth.uid()));

drop policy if exists "Owner can queue automation requests" on public.automation_requests;
create policy "Owner can queue automation requests" on public.automation_requests for insert to authenticated
with check (
  public.is_wahl_owner()
  and requested_by = (select auth.uid())
  and status = 'queued'
  and pull_request_url is null
  and exists (
    select 1 from public.posts
    where posts.id = post_id
      and posts.author_id = (select auth.uid())
      and posts.audience_type = 'private'
      and posts.text ~* '#fix\y'
  )
);

-- After signing in once, register the owner from the Supabase SQL editor:
-- insert into public.site_owners (user_id)
-- select id from auth.users where email = 'your-email@example.com';
