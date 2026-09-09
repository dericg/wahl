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

create index if not exists idx_wahl_messages_conversation_time
  on public.wahl_messages (conversation_id, created_at, id);

alter table public.wahl_conversations enable row level security;
alter table public.wahl_messages enable row level security;

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
