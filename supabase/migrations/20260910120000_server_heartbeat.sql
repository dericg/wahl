create table if not exists public.server_heartbeats (
  server_name text primary key check (server_name = 'ubuntu'),
  last_seen_at timestamptz not null default now()
);

alter table public.server_heartbeats enable row level security;
revoke all on public.server_heartbeats from anon, authenticated;
grant select on public.server_heartbeats to authenticated;
grant select, insert, update on public.server_heartbeats to service_role;

drop policy if exists "Owner can read server heartbeats" on public.server_heartbeats;
create policy "Owner can read server heartbeats" on public.server_heartbeats for select to authenticated
using (public.is_wahl_owner());
