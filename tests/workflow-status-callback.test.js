import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/wahl-fix.yml", import.meta.url), "utf8");
const callbackFunction = readFileSync(new URL("../supabase/functions/update-wahl-fix/index.ts", import.meta.url), "utf8");
const statusCallback = readFileSync(new URL("../supabase/functions/record-wahl-activity/index.ts", import.meta.url), "utf8");
const testDeployment = readFileSync(new URL("../.github/workflows/deploy-test.yml", import.meta.url), "utf8");
const reviewedMerge = readFileSync(new URL("../.github/workflows/merge-reviewed-pr.yml", import.meta.url), "utf8");
const revisePullRequest = readFileSync(new URL("../.github/workflows/revise-wahl-pr.yml", import.meta.url), "utf8");
const schema = readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
const serviceRoleGrant = readFileSync(new URL("../supabase/migrations/20260906194000_automation_service_role_grants.sql", import.meta.url), "utf8");

test("workflow reports working and every completion outcome", () => {
  assert.match(workflow, /status: "working"/);
  assert.match(workflow, /echo "status=no_change"/);
  assert.match(workflow, /echo "status=pr_ready"/);
  assert.match(workflow, /status: "failed"/);
  assert.match(workflow, /pull_request_url=\$pr_url/);
  assert.match(workflow, /if: \$\{\{ failure\(\) && steps\.request\.outputs\.track_status == 'true' \}\}/);
});

test("workflow can safely reuse an existing Wahl issue without a Supabase request", () => {
  assert.match(workflow, /issue-only run/);
  assert.match(workflow, /gh issue view "\$ISSUE_NUMBER" --repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /GITHUB_REPOSITORY" != "dericg\/wahl/);
  assert.match(workflow, /Issue-only automation requires an open issue/);
  assert.match(workflow, /track_status=false/);
  assert.match(workflow, /steps\.request\.outputs\.track_status == 'true'/);
  assert.match(workflow, /EXISTING_ISSUE_NUMBER: \$\{\{ steps\.request\.outputs\.issue_number \}\}/);
  assert.match(workflow, /Closes #\$ISSUE_NUMBER/);
});

test("workflow callback uses only configured secrets for authentication and location", () => {
  assert.match(workflow, /secrets\.WAHL_STATUS_CALLBACK_TOKEN/);
  assert.match(workflow, /secrets\.WAHL_SUPABASE_URL/);
  assert.doesNotMatch(workflow, /VITE_SUPABASE/);
});

test("callback accepts no browser credentials and limits updates to active requests", () => {
  assert.doesNotMatch(callbackFunction, /Access-Control-Allow-Origin/);
  assert.match(callbackFunction, /Deno\.env\.get\("WAHL_STATUS_CALLBACK_TOKEN"\)/);
  assert.match(callbackFunction, /\.in\("status", \["queued", "working"\]\)/);
  assert.match(callbackFunction, /crypto\.subtle\.digest/);
});

test("status callback has the table privileges required by its service role", () => {
  const grant = /grant select, update on public\.automation_requests to service_role;/;
  assert.match(schema, grant);
  assert.match(serviceRoleGrant, grant);
});

test("validated pull requests dispatch a serialized test-backend deployment", () => {
  assert.match(workflow, /event_type=wahl_test_deploy/);
  assert.match(testDeployment, /group: wahl-test-backend/);
  assert.match(testDeployment, /SUPABASE_DB_PASSWORD: \$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/);
  assert.match(testDeployment, /jq -sRr @uri/);
  assert.match(testDeployment, /aws-0-us-west-2\.pooler\.supabase\.com:6543/);
  assert.match(testDeployment, /supabase db push --db-url "\$db_url"/);
  assert.doesNotMatch(testDeployment, /supabase link/);
  assert.doesNotMatch(testDeployment, /SUPABASE_DB_URL/);
  assert.match(testDeployment, /environment: test/);
  assert.match(testDeployment, /actions\/upload-pages-artifact@v3/);
  assert.match(testDeployment, /actions\/deploy-pages@v4/);
  assert.match(testDeployment, /WAHL_BASE_PATH: \/wahl\//);
  assert.match(testDeployment, /gh pr comment "\$PR" --repo "\$GITHUB_REPOSITORY"/);
  assert.match(testDeployment, /test-deployment:\$\{GITHUB_RUN_ID\}/);
  assert.match(testDeployment, /Reader summary/);
  assert.match(testDeployment, /gsub\("\[\[:cntrl:\]\]"; " "\)/);
  assert.match(testDeployment, /github-pages · success · #\$\{PR\} · reader:\$\{reader_summary\}/);
  assert.match(testDeployment, /functions\/v1\/record-wahl-activity/);
  assert.match(statusCallback, /readerSummaryFromBody/);
  assert.match(statusCallback, /api\.github\.com\/repos\/dericg\/wahl\/pulls/);
});

test("owner-reviewed merges run in a trusted bounded workflow", () => {
  assert.match(reviewedMerge, /workflow_dispatch:/);
  assert.match(reviewedMerge, /pull_request_number:/);
  assert.match(reviewedMerge, /group: wahl-main-merge/);
  assert.match(reviewedMerge, /timeout-minutes: 5/);
  assert.match(reviewedMerge, /contents: write/);
  assert.match(reviewedMerge, /pull-requests: write/);
  assert.match(reviewedMerge, /actions: read/);
  assert.match(reviewedMerge, /test "\$current_main" = "\$EXPECTED_BASE"/);
  assert.match(reviewedMerge, /\.mergeable_state/);
  assert.match(reviewedMerge, /actions\/workflows\/ci\.yml\/runs/);
  assert.match(reviewedMerge, /wahl\/revision-validation/);
  assert.match(reviewedMerge, /-f sha="\$EXPECTED_HEAD" -f merge_method=squash/);
  assert.doesNotMatch(reviewedMerge, /secrets\./);
});

test("owner comments can request a bounded Codex revision of the same pull request", () => {
  assert.match(revisePullRequest, /issue_comment:/);
  assert.match(revisePullRequest, /github\.actor == 'dericg'/);
  assert.match(revisePullRequest, /author_association == 'OWNER'/);
  assert.match(revisePullRequest, /test "\$first_line" = "\/codex revise"/);
  assert.match(revisePullRequest, /openai\/codex-action@v1/);
  assert.match(revisePullRequest, /secrets\.OPENAI_API_KEY/);
  assert.match(revisePullRequest, /codex\/wahl-fix-/);
  assert.match(revisePullRequest, /git status --short -- AGENTS\.md \.github\/workflows/);
  assert.match(revisePullRequest, /npm test/);
  assert.match(revisePullRequest, /npm run build/);
  assert.match(revisePullRequest, /wahl\/revision-validation/);
  assert.match(revisePullRequest, /event_type=wahl_test_deploy/);
  assert.doesNotMatch(revisePullRequest, /pulls\/\$PR_NUMBER\/merge/);
});
