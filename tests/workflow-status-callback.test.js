import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/wahl-fix.yml", import.meta.url), "utf8");
const callbackFunction = readFileSync(new URL("../supabase/functions/update-wahl-fix/index.ts", import.meta.url), "utf8");
const testDeployment = readFileSync(new URL("../.github/workflows/deploy-test.yml", import.meta.url), "utf8");

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

test("validated pull requests dispatch a serialized test-backend deployment", () => {
  assert.match(workflow, /event_type=wahl_test_deploy/);
  assert.match(testDeployment, /group: wahl-test-backend/);
  assert.match(testDeployment, /supabase db push --db-url/);
  assert.match(testDeployment, /environment: test/);
  assert.match(testDeployment, /actions\/upload-pages-artifact@v3/);
  assert.match(testDeployment, /actions\/deploy-pages@v4/);
  assert.match(testDeployment, /WAHL_BASE_PATH: \/wahl\//);
});
