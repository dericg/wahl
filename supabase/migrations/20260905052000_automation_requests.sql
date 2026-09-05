create table if not exists public.automation_requests (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'working', 'pr_ready', 'failed', 'closed')),
  pull_request_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.automation_requests enable row level security;

revoke all on public.automation_requests from anon, authenticated;
grant select on public.automation_requests to authenticated;

drop policy if exists "Owner can read automation requests" on public.automation_requests;
create policy "Owner can read automation requests" on public.automation_requests for select to authenticated
using (public.is_wahl_owner() and requested_by = (select auth.uid()));
