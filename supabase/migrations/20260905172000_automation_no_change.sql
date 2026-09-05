alter table public.automation_requests
  drop constraint if exists automation_requests_status_check;

alter table public.automation_requests
  add constraint automation_requests_status_check
  check (status in ('queued', 'working', 'pr_ready', 'no_change', 'failed', 'closed'));
