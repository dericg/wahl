create table if not exists public.link_previews (
  url text primary key check (char_length(url) between 1 and 2048),
  title text check (title is null or char_length(title) <= 240),
  description text check (description is null or char_length(description) <= 400),
  site_name text check (site_name is null or char_length(site_name) <= 120),
  image_url text check (image_url is null or char_length(image_url) <= 2048),
  status text not null check (status in ('ready', 'unavailable')),
  fetched_at timestamptz not null default now()
);

alter table public.link_previews enable row level security;
revoke all on public.link_previews from anon, authenticated;
grant select on public.link_previews to authenticated;
grant select, insert, update on public.link_previews to service_role;

drop policy if exists "Owner can read link previews" on public.link_previews;
create policy "Owner can read link previews" on public.link_previews for select to authenticated
using (public.is_wahl_owner());
