# Wahl

A quiet, intentionally small personal wall for thoughts that would have been a status update.

## Run locally

```bash
npm install
npm run dev
```

The launch MVP is a single-page personal website backed by Supabase Postgres. Public visitors can read published posts; the registered owner can sign in with email and password, publish posts, keep private drafts, and delete entries. Row-level security enforces access in the database.

Without Supabase environment variables, the development server runs as an interactive local preview. Production builds without those variables are read-only.

## Production setup

1. Create a Supabase project and run `database/schema.sql` in its SQL editor.
2. Copy `.env.example` to `.env.local` and add the project URL and publishable key.
3. Start Wahl, use **Owner sign in** once, then register that account in `site_owners` using the final query documented in the schema.
4. Add the production site URL to the allowed redirect URLs in Supabase Auth before deploying.

## `#fix` automation

The owner can publish a private thought containing `#fix`, then choose **Send to Codex** on that post. Wahl immediately shows the request as sent and calls an authenticated Supabase Edge Function. The function verifies that the requester is a registered owner and that the post belongs to that owner, is private, and contains `#fix`. Row-level security independently enforces the same requirements when the automation request is inserted.

For each eligible thought, Wahl creates one `automation_requests` record and dispatches `.github/workflows/wahl-fix.yml` with the request ID, post ID, and thought. The workflow then:

1. Checks out `main` and installs the locked dependencies.
2. Creates a GitHub issue to record the request.
3. Runs Codex in an ephemeral session under the constraints in `AGENTS.md`.
4. Builds the site to validate the proposed change.
5. If files changed, creates a `codex/wahl-fix-<request-id>` branch and opens a pull request that references the issue.
6. Reports the final result and pull-request URL back to Supabase.

The automation record supports `queued`, `working`, `pr_ready`, `no_change`, `failed`, and `closed` states. The wall checks Supabase every ten seconds while work is active, and **View progress** opens the latest status inside Wahl with a manual refresh fallback. A successful run links to its review pull request; a no-change or failed run displays an explicit outcome. If initial dispatch fails, Wahl removes the optimistic sent state from the page and displays the error so the owner can retry. An expired session requires signing in again.

### Automation configuration

The workflow requires these GitHub Actions secrets:

- `OPENAI_API_KEY` for the Codex action
- `WAHL_SUPABASE_URL` for the deployed Supabase project URL
- `WAHL_STATUS_CALLBACK_TOKEN` for authenticated workflow status updates

The `dispatch-wahl-fix` Edge Function requires a fine-grained, repository-scoped GitHub token named `WAHL_GITHUB_TOKEN` with **Actions: write** permission. The `update-wahl-fix` Edge Function requires the same `WAHL_STATUS_CALLBACK_TOKEN` value stored as a Supabase secret. Use a long random value and never expose it to the browser or commit it.

Before enabling callbacks, apply the database migration that adds `no_change`, deploy both Edge Functions, and configure the matching GitHub and Supabase secrets. The automation never merges or deploys automatically.
