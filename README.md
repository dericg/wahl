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

The automation record supports `queued`, `working`, `pr_ready`, `failed`, and `closed` states. If dispatch fails, Wahl removes the optimistic sent state from the page and displays the error so the owner can retry. An expired session requires signing in again.

### Known status limitation

The GitHub workflow currently does not report completion back to Supabase, and the wall does not poll GitHub or reinvoke the Edge Function after dispatch. As a result, a successful request will normally remain labeled **Sent to Codex** with a **View progress** link, even after its pull request is ready. The Edge Function can discover an existing pull request and update the record when called again, but the current UI does not provide that refresh path. Status synchronization should be implemented before relying on **Codex is working**, **Pull request ready**, **Needs attention**, or the pull-request link as automatic live indicators.

The workflow requires an Actions secret named `OPENAI_API_KEY`. The Edge Function requires a fine-grained, repository-scoped GitHub token named `WAHL_GITHUB_TOKEN` with **Actions: write** permission. It never merges or deploys automatically.
