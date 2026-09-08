update public.repository_activity
set summary = 'github-pages · success · #48 · reader:The update adds a private way to browse his old Facebook posts, photos, videos, and links inside Wahl. It also includes an “On this day” section for revisiting memories from past years.'
where kind = 'Deployment'
  and source_id like 'test-deployment:%'
  and summary like 'github-pages · success · #48 · %';
