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

Recent commits, issues, pull requests, deployments, and workflow results appear as read-only cards in the same reverse-chronological feed as Wahl thoughts. All keeps lifecycle events in chronological order. GitHub issues shows one entry per issue in its newest loaded state, with a count of distinct issues loaded. The wall initially displays up to 20 combined entries; Load older extends the same feed. Counts describe loaded entries, not repository totals. Every card shows relative age and the exact local time, and relative ages refresh while the wall is open. Each event links to its source on GitHub. The local preview uses recent build commits when live activity is unavailable.

GitHub Actions sends normalized event summaries to the authenticated `record-wahl-activity` Edge Function. The function validates the shared callback token and Wahl-only GitHub URLs before writing to `repository_activity`. Public visitors may read these events, but browser clients cannot insert or modify them. Run the activity workflow manually once after rollout to seed recent history; later events arrive automatically.

For the feed integrity update, apply `supabase/migrations/20260906120000_feed_integrity.sql` (also recorded in `database/schema.sql`) before deploying the updated recorder and app. The idempotent migration removes recorder/unfinished workflow noise, reconciles workflow attempts and duplicate issue snapshots, and guards against older callbacks overwriting newer outcomes. Only completed outcomes from Validate Wahl and Turn a Wahl thought into a pull request are retained. The existing manual activity workflow backfills all historical issues; repeating it reuses update identities. No workflow file changes are required.

Pagination uses timestamp and ID cursors for each source, preserves timestamp precision, and only advances over consumed rows. A failed older-page read preserves both cursors for retry. If the first activity read fails, the session uses the build's recent commits so thoughts remain available; reload to retry live activity. Newly arriving or updated events above the loaded cursors appear on reload.

Before merging, manually check desktop and narrow layouts, keyboard and touch access to timestamps and Load older, and owner/public sign-in transitions. Browser checks and live database changes are intentionally excluded from fix automation.

## Production setup

1. Create a Supabase project and run `database/schema.sql` in its SQL editor.
2. Copy `.env.example` to `.env.local` and add the project URL and publishable key.
3. Start Wahl, use **Owner sign in** once, then register that account in `site_owners` using the final query documented in the schema.
4. Add the production site URL to the allowed redirect URLs in Supabase Auth before deploying.

## `#fix` automation

The owner can publish a private thought containing `#fix`, then choose **Send to Codex** on that post. Wahl immediately shows the request as sent and calls an authenticated Supabase Edge Function. The function verifies that the requester is a registered owner and that the post belongs to that owner, is private, and contains `#fix`. Row-level security independently enforces the same requirements when the automation request is inserted.

For each eligible thought, Wahl creates one `automation_requests` record and dispatches `.github/workflows/wahl-fix.yml` with the request ID, post ID, and thought. A repository maintainer may instead run the same workflow manually with only an existing open Wahl issue number. Issue-only runs fetch the title and body from the current repository and do not require or update a Supabase automation record. The workflow then:

1. Checks out `main` and installs the locked dependencies.
2. Creates a GitHub issue for a Wahl thought, or reuses and validates the supplied issue for an issue-only run.
3. Runs Codex in an ephemeral session under the constraints in `AGENTS.md`.
4. Builds the site to validate the proposed change.
5. If files changed, creates a `codex/wahl-fix-<request-id>` branch and opens a pull request that references the issue.
6. Reports the final result and pull-request URL back to Supabase.

The automation record supports `queued`, `working`, `pr_ready`, `no_change`, `failed`, and `closed` states. The wall checks Supabase every ten seconds while work is active, and **View progress** opens the latest status inside Wahl with a manual refresh fallback. A successful run links to its review pull request; a no-change or failed run displays an explicit outcome. If initial dispatch fails, Wahl removes the optimistic sent state from the page and displays the error so the owner can retry. An expired session requires signing in again. Issue-only runs report through GitHub Actions, the issue, and the resulting pull request rather than through Wahl's per-post progress UI.

For a pull request linked to a private fix thought, the signed-in owner can open **View progress → Check merge readiness**. Wahl checks GitHub live: the PR must be open, non-draft, within `dericg/wahl`, targeting and up to date with `main`, with a clean merge status and a successful **Validate Wahl** pull-request run for its head commit. The owner must review the linked issue, repository instructions, current main, and test-site interactions before checking the review confirmation and choosing **Merge PR**. The server repeats its checks and sends the approved head SHA to GitHub for a squash merge. Changed commits or main require a fresh review; errors clear the confirmation. GitHub remains authoritative for branch protections and merge permission. Public activity cards stay read-only, and issue-only PRs continue to be reviewed on GitHub. Merging does not publish a production release.

This manual owner action requires a separate, repository-scoped Supabase secret, `WAHL_MERGE_GITHUB_TOKEN`, with **Contents: write**, **Pull requests: read**, and **Actions: read** permissions. Do not give it repository-rule bypass privileges or expose it to the Codex job, workflow callbacks, or browser. Keep branch protection requiring current validation so GitHub enforces changes to main that race the final merge request. Enable squash merging in the repository. Without the secret, Wahl explains that merging is not configured and retains the GitHub review link. The existing `dispatch-wahl-fix` deployment carries this authenticated action; there is no new function deployment or database migration. Automation dispatch and status callbacks never invoke it or use this token. Before accepting this change, manually verify the confirmation, sign-out behavior, and narrow/keyboard layout; automated validation does not start a browser or perform a real merge.

To run an existing issue, open **Actions → Turn a Wahl thought into a pull request → Run workflow**, enter its number in `issue_number`, and leave `request_id`, `post_id`, and `thought` empty. GitHub restricts manual workflow dispatch to users with write access. The issue must be open and belong to this repository. Its content remains untrusted task input, and the Codex job never merges or deploys the result.

When a review pull request is created, the workflow dispatches `deploy-test.yml`. That trusted, serialized workflow revalidates the exact PR commit, applies committed migrations to the owner-approved live Supabase test backend, deploys the Wahl Edge Functions, publishes the frontend to GitHub Pages, and comments the review URL on the pull request. Its Supabase credentials live only in the GitHub `test` environment. OpenAI Sites remains a separate production publishing path.

### Automation configuration

The workflow requires these GitHub Actions secrets:

- `OPENAI_API_KEY` for the Codex action
- `WAHL_SUPABASE_URL` for the deployed Supabase project URL
- `WAHL_STATUS_CALLBACK_TOKEN` for authenticated workflow status updates

The `dispatch-wahl-fix` Edge Function requires a fine-grained, repository-scoped GitHub token named `WAHL_GITHUB_TOKEN` with **Actions: write** permission. The `update-wahl-fix` and `record-wahl-activity` Edge Functions require the same `WAHL_STATUS_CALLBACK_TOKEN` value stored as a Supabase secret. Use a long random value and never expose it to the browser or commit it.

The database must grant `service_role` both `select` and `update` on `automation_requests`; the status callback updates and returns the request row. Migration `20260906194000_automation_service_role_grants.sql` establishes these privileges idempotently. Without them, a `#fix` dispatch stops before Codex runs and Postgres reports SQLSTATE `42501`.

Before enabling callbacks, apply the database migration that adds `no_change`, deploy both Edge Functions, and configure the matching GitHub and Supabase secrets. The automation never merges automatically, and production publishing remains separately approved.

### Test deployment setup and operation

Create a GitHub environment named `test` with this exact configuration:

| Kind | Name | Value or purpose |
| --- | --- | --- |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase CLI access token |
| Secret | `SUPABASE_DB_PASSWORD` | Wahl database password shown by Supabase Connect; this is not an account password or API key |
| Variable | `SUPABASE_PROJECT_REF` | `rzmgyvkvfjbcsxegafko` |
| Variable | `VITE_SUPABASE_URL` | `https://rzmgyvkvfjbcsxegafko.supabase.co` |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Wahl publishable key |

`SUPABASE_DB_URL` is not used by the current workflow. GitHub-hosted runners use Wahl's IPv4-compatible transaction pooler at `aws-0-us-west-2.pooler.supabase.com:6543`. The workflow removes accidental copied line endings, safely percent-encodes `SUPABASE_DB_PASSWORD`, constructs the connection URL only in the runner, and calls `supabase db push --db-url "$db_url"`. Port `6543` has been directly verified with `psql`; the session pooler on `5432` rejected the same valid password. Do not add `supabase link`: Wahl's access token can deploy functions but does not have the Supabase organization privilege required by that Management API operation.

To deploy an open pull request for review, open **Actions → Deploy Wahl test backend → Run workflow** and enter the pull-request number. The CLI equivalent is:

```bash
gh workflow run deploy-test.yml --repo dericg/wahl --ref main \
  -f pull_request_number=23
```

Use the applicable pull-request number rather than always using `23`. A successful run completes validation, database migrations, Edge Function deployment, and GitHub Pages deployment, then comments the review URL on the pull request. If the run fails, inspect its failed step before rotating credentials:

- Empty `RAW_SUPABASE_PROJECT_REF`: the environment variable is missing or the workflow is reading `secrets` instead of `vars`.
- `IPv6 is not supported`: the workflow used Supabase's direct endpoint instead of Wahl's Shared Pooler.
- Authorization failure during `supabase link`: remove the link step and use the Shared Pooler URL; the configured token intentionally lacks that Management API privilege.
- Password or SASL authentication failure on port `6543`: update only `SUPABASE_DB_PASSWORD` with the current database password. Failure only on port `5432` is a session-pooler issue and is not evidence that the password is wrong.
- `Remote migration versions not found`: compare the remote versions with repository history. Never rename or round an applied migration timestamp and never blindly mark a real migration reverted. Wahl's initial recorded versions are `20260905053925` and `20260905062255`.
- A version applied by an unmerged test PR is still part of the shared database's forward-only history. Carry that exact migration file into later deployment branches and `main`; do not replace it with an empty placeholder. Migration `20260906120000` entered the shared baseline through PR #23.
- `not a git repository` during the final comment: the Pages job has no checkout, so its `gh pr comment` command must include `--repo "$GITHUB_REPOSITORY"`. The site may already have published successfully even though the overall run is marked failed.

After correcting the specific cause, rerun the same workflow with the same pull-request number. A migration failure deliberately prevents Edge Function and Pages deployment, so there is no new test site to review until all three jobs pass.
