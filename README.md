# Wahl

A quiet, intentionally small personal wall for thoughts that would have been a status update.

## Run locally

```bash
npm install
npm run dev
```

The launch MVP is a single-page personal website backed by Supabase Postgres. Public visitors can read published posts; the registered owner can sign in with email and password, publish posts, keep private drafts, and delete entries. Row-level security enforces access in the database.

Without Supabase environment variables, the development server runs as an interactive local preview. Production builds without those variables are read-only.

## Repository activity

The wall mixes thoughts with recent public activity from `dericg/wahl`, newest first: commits on the default branch, opened/closed issues, opened/closed/merged pull requests, GitHub deployments and their latest status, and workflow runs. Activity cards link to GitHub and have no editing controls.

Each page load makes bounded, unauthenticated GitHub API requests (up to ten); no token or additional configuration is required. This is a recent snapshot, not a complete archive: it reads up to ten records per source and five deployments, without polling. Deployments appear only when recorded in GitHub; publishing through Sites alone does not create a GitHub deployment. Private repository activity is not fetched. If GitHub is unavailable or rate limited, the wall keeps working, shows a small availability message, and uses the build's five commits as a fallback. Commit timestamps include time and timezone for ordering alongside thoughts.

Repository events are read-only external data and are not stored as Supabase posts. Existing post audiences and owner-only access to private thoughts and automation requests remain enforced by row-level security.

## Production setup

1. Create a Supabase project and run `database/schema.sql` in its SQL editor.
2. Copy `.env.example` to `.env.local` and add the project URL and publishable key.
3. Start Wahl, use **Owner sign in** once, then register that account in `site_owners` using the final query documented in the schema.
4. Add the production site URL to the allowed redirect URLs in Supabase Auth before deploying.

## `#fix` automation

The owner can publish a private thought containing `#fix`, then choose **Send to Codex** on that post. An authenticated Supabase Edge Function verifies the owner and starts `.github/workflows/wahl-fix.yml` directly. Codex implements the request on a dedicated branch, validates the production build, and opens a pull request for review.

The workflow requires an Actions secret named `OPENAI_API_KEY`. The Edge Function requires a fine-grained, repository-scoped GitHub token named `WAHL_GITHUB_TOKEN` with **Actions: write** permission. It never merges or deploys automatically.
