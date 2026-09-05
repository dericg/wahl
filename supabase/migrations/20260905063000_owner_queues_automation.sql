grant insert on public.automation_requests to authenticated;

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
