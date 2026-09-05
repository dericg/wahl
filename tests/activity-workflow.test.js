import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/wahl-activity.yml", import.meta.url), "utf8");
const callback = readFileSync(new URL("../supabase/functions/record-wahl-activity/index.ts", import.meta.url), "utf8");

test("activity workflow covers repository lifecycle events and a historical seed", () => {
  for (const event of ["push:", "issues:", "pull_request:", "deployment_status:", "workflow_run:", "workflow_dispatch:"]) assert.match(workflow, new RegExp(event));
  assert.match(workflow, /scripts\/activity-event\.mjs seed/);
  assert.match(workflow, /secrets\.WAHL_STATUS_CALLBACK_TOKEN/);
  assert.match(workflow, /secrets\.WAHL_SUPABASE_URL/);
});

test("activity callback is server-only and writes through the service role", () => {
  assert.doesNotMatch(callback, /Access-Control-Allow-Origin/);
  assert.match(callback, /Deno\.env\.get\("WAHL_STATUS_CALLBACK_TOKEN"\)/);
  assert.match(callback, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(callback, /\.from\("repository_activity"\)\.upsert/);
});
