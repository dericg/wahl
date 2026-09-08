-- Keep the combined reader summary within the activity limit as a complete thought.
-- Preserve source IDs and occurrence times so the wall chronology does not move.
update public.repository_activity
set summary = 'github-pages · success · #48 · reader:The update adds a private Facebook archive with posts, photos, videos, links, and “On this day” memories. It also makes Wahl’s GitHub history easier to follow with plain-language summaries that show the original date and time.'
where kind = 'Deployment'
  and url = 'https://github.com/dericg/wahl/pull/48';
