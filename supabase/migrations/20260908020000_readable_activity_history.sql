-- Repair the only legacy PR-specific deployment without a readable summary.
-- Keep source_id and occurred_at unchanged so its position in the wall is stable.
update public.repository_activity
set summary = 'github-pages · success · #46 · reader:Deric added a written review of Wahl with five ideas for improving the site. This update does not change the site itself.'
where source_id = 'test-deployment:34074794321'
  and url = 'https://github.com/dericg/wahl/pull/46';
