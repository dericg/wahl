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
