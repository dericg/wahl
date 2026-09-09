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

create table if not exists public.repository_activity (
  source_id text primary key check (char_length(source_id) between 1 and 160),
  kind text not null check (kind in ('Commit', 'Issue', 'Pull request', 'Deployment', 'Workflow')),
  summary text not null check (char_length(summary) between 1 and 320),
  url text not null check (url ~ '^https://github.com/dericg/wahl(/|$)'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.wahl_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wahl_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wahl_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now()
);

create index if not exists idx_posts_created_at on public.posts (created_at desc);
create index if not exists idx_repository_activity_occurred_at on public.repository_activity (occurred_at desc);
create index if not exists idx_wahl_messages_conversation_time on public.wahl_messages (conversation_id, created_at, id);
alter table public.site_owners enable row level security;
alter table public.posts enable row level security;
alter table public.automation_requests enable row level security;
alter table public.repository_activity enable row level security;
alter table public.wahl_conversations enable row level security;
alter table public.wahl_messages enable row level security;

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
grant select, update on public.automation_requests to service_role;
revoke all on public.repository_activity from anon, authenticated;
grant select on public.repository_activity to anon, authenticated;
grant select, insert, update on public.repository_activity to service_role;
revoke all on public.wahl_conversations from anon, authenticated;
revoke all on public.wahl_messages from anon, authenticated;
grant select on public.wahl_conversations to authenticated;
grant select on public.wahl_messages to authenticated;
grant select, insert, update on public.wahl_conversations to service_role;
grant select, insert on public.wahl_messages to service_role;

drop policy if exists "Owner can read Wahl conversations" on public.wahl_conversations;
create policy "Owner can read Wahl conversations" on public.wahl_conversations for select to authenticated
using (public.is_wahl_owner() and owner_id = (select auth.uid()));

drop policy if exists "Owner can read Wahl messages" on public.wahl_messages;
create policy "Owner can read Wahl messages" on public.wahl_messages for select to authenticated
using (
  public.is_wahl_owner()
  and exists (
    select 1 from public.wahl_conversations
    where wahl_conversations.id = conversation_id
      and wahl_conversations.owner_id = (select auth.uid())
  )
);

drop policy if exists "Repository activity is publicly readable" on public.repository_activity;
create policy "Repository activity is publicly readable" on public.repository_activity for select to anon, authenticated
using (true);

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

-- Run before deploying the feed and recorder changes. No post policies change.
begin;
lock table public.repository_activity in share row exclusive mode;

create index if not exists idx_posts_feed_cursor on public.posts (created_at desc, id asc);
create index if not exists idx_repository_activity_feed_cursor on public.repository_activity (occurred_at desc, source_id asc);

-- Lifecycle events remain chronological in All. A snapshot of the same issue
-- update shares an identity even if GitHub describes its action differently.
create or replace function public.wahl_activity_identity(kind text, url text, occurred_at timestamptz, source_id text)
returns text language sql immutable set search_path = public
as $$
  select case
    when kind = 'Workflow' and url ~ '^https://github.com/dericg/wahl/actions/runs/[0-9]+(/attempts/[0-9]+)?$'
      then 'workflow:' || substring(url from '/runs/([0-9]+)')
    when kind = 'Issue' and url ~ '^https://github.com/dericg/wahl/issues/[0-9]+/?$'
      then 'issue:' || substring(url from '/issues/([0-9]+)') || ':' ||
        to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    else source_id
  end;
$$;
revoke all on function public.wahl_activity_identity(text, text, timestamptz, text) from public;
grant execute on function public.wahl_activity_identity(text, text, timestamptz, text) to service_role;

-- Only the two selected workflows' meaningful final outcomes belong on Wahl.
-- This also removes stale queued/in_progress snapshots and recorder self-noise.
delete from public.repository_activity
where kind = 'Workflow' and (
  summary !~ '^(Validate Wahl|Turn a Wahl thought into a pull request) · (success|failure|cancelled|timed_out|action_required|startup_failure)$'
  or url !~ '^https://github.com/dericg/wahl/actions/runs/[0-9]+(/attempts/[0-9]+)?$'
);

-- Reconcile retries, run attempts and historical snapshots before renaming IDs.
with ranked as (
  select source_id, row_number() over (
    partition by public.wahl_activity_identity(kind, url, occurred_at, source_id)
    order by occurred_at desc, created_at desc, source_id desc
  ) as position
  from public.repository_activity
)
delete from public.repository_activity activity using ranked
where activity.source_id = ranked.source_id and ranked.position > 1;

update public.repository_activity
set source_id = public.wahl_activity_identity(kind, url, occurred_at, source_id),
    url = case
      when kind = 'Workflow' then regexp_replace(url, '/attempts/[0-9]+$', '')
      when kind = 'Issue' then regexp_replace(url, '/$', '')
      else url
    end
where source_id <> public.wahl_activity_identity(kind, url, occurred_at, source_id)
   or (kind = 'Workflow' and url ~ '/attempts/[0-9]+$')
   or (kind = 'Issue' and url ~ '/$');

-- The update guard runs under the upsert row lock: an out-of-order callback
-- cannot regress a completed workflow, including across concurrent retries.
create or replace function public.reconcile_wahl_activity()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.kind = 'Workflow' and (
    new.summary !~ '^(Validate Wahl|Turn a Wahl thought into a pull request) · (success|failure|cancelled|timed_out|action_required|startup_failure)$'
    or new.url !~ '^https://github.com/dericg/wahl/actions/runs/[0-9]+(/attempts/[0-9]+)?$'
  ) then return null; end if;
  if tg_op = 'UPDATE' then
    if new.occurred_at < old.occurred_at then return null; end if;
  end if;
  new.source_id := public.wahl_activity_identity(new.kind, new.url, new.occurred_at, new.source_id);
  if new.kind = 'Workflow' then new.url := regexp_replace(new.url, '/attempts/[0-9]+$', ''); end if;
  if new.kind = 'Issue' then new.url := regexp_replace(new.url, '/$', ''); end if;
  return new;
end;
$$;
revoke all on function public.reconcile_wahl_activity() from public;
drop trigger if exists reconcile_wahl_activity on public.repository_activity;
create trigger reconcile_wahl_activity before insert or update on public.repository_activity
for each row execute function public.reconcile_wahl_activity();
commit;
