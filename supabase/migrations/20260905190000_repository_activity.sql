create table if not exists public.repository_activity (
  source_id text primary key check (char_length(source_id) between 1 and 160),
  kind text not null check (kind in ('Commit', 'Issue', 'Pull request', 'Deployment', 'Workflow')),
  summary text not null check (char_length(summary) between 1 and 320),
  url text not null check (url ~ '^https://github.com/dericg/wahl(/|$)'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_repository_activity_occurred_at on public.repository_activity (occurred_at desc);
alter table public.repository_activity enable row level security;
revoke all on public.repository_activity from anon, authenticated;
grant select on public.repository_activity to anon, authenticated;
grant select, insert, update on public.repository_activity to service_role;
drop policy if exists "Repository activity is publicly readable" on public.repository_activity;
create policy "Repository activity is publicly readable" on public.repository_activity for select to anon, authenticated using (true);
