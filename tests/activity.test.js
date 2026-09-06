import test from "node:test";
import assert from "node:assert/strict";
import { activityPayloads, filterWallEntries, mergeActivity, releaseActivity, snapshotActivity, wallEntries } from "../src/activity.js";
import { validateActivity } from "../supabase/functions/_shared/wahl-activity-policy.js";

const repository = { full_name: "dericg/wahl" };
const occurredAt = "2026-09-05T18:00:00Z";

test("release commits become Wahl repository links", () => {
  assert.deepEqual(releaseActivity([{ hash: "abcdef1", date: occurredAt, message: "A change" }]), [{ source_id: "commit:abcdef1", kind: "Commit", summary: "A change", url: "https://github.com/dericg/wahl/commit/abcdef1", occurred_at: occurredAt }]);
  assert.deepEqual(releaseActivity([{ hash: "bad", date: occurredAt, message: "Ignored" }]), []);
});

test("activity merges by source and remains newest first", () => {
  const remote = [
    { source_id: "issue:6:live", kind: "Issue", summary: "Issue", url: "https://github.com/dericg/wahl/issues/6", occurred_at: "2026-09-06T00:00:00Z" },
    { source_id: "issue:6:snapshot", kind: "Issue", summary: "Issue", url: "https://github.com/dericg/wahl/issues/6", occurred_at: "2026-09-06T00:00:00Z" },
  ];
  assert.deepEqual(mergeActivity(remote, [{ hash: "abcdef1", date: occurredAt, message: "Commit" }]).map((entry) => entry.source_id), ["issue:6:snapshot", "commit:abcdef1"]);
});

test("thoughts and GitHub events form one chronological wall feed", () => {
  const posts = [{ id: "thought", text: "A thought", created_at: "2026-09-05T19:00:00Z" }];
  const activity = [{ source_id: "issue:6", kind: "Issue", summary: "Issue", url: "https://github.com/dericg/wahl/issues/6", occurred_at: "2026-09-05T20:00:00Z" }];
  const entries = wallEntries(posts, activity);
  assert.deepEqual(entries.map((entry) => entry.entry_type), ["activity", "thought"]);
  assert.equal(entries[0].id, "github:issue:6");
});

test("issues filter returns only GitHub issue events", () => {
  const entries = [
    { id: "thought", entry_type: "thought" },
    { id: "github:issue:6", entry_type: "activity", kind: "Issue" },
    { id: "github:issue:6:older", entry_type: "activity", kind: "Issue" },
    { id: "github:pr:15", entry_type: "activity", kind: "Pull request" },
  ];
  entries[1].url = entries[2].url = "https://github.com/dericg/wahl/issues/6";
  assert.deepEqual(filterWallEntries(entries, "issues"), [entries[1]]);
  assert.equal(filterWallEntries(entries, "all"), entries);
});

test("GitHub events normalize without trusting deployment target URLs", () => {
  const issue = activityPayloads("issues", { repository, action: "opened", issue: { number: 6, title: "Activity", html_url: "https://github.com/dericg/wahl/issues/6", updated_at: occurredAt } });
  assert.equal(issue[0].summary, "opened #6 · Activity");
  const deployment = activityPayloads("deployment_status", { repository, deployment: { id: 2, environment: "Production" }, deployment_status: { id: 3, state: "success", target_url: "https://evil.example", created_at: occurredAt } });
  assert.equal(deployment[0].url, "https://github.com/dericg/wahl/deployments");
  assert.deepEqual(activityPayloads("issues", { repository: { full_name: "other/repo" } }), []);
  assert.equal(Array.from(activityPayloads("push", { repository, ref: "refs/heads/main", commits: [{ id: "a".repeat(40), message: "x".repeat(400), timestamp: occurredAt }] })[0].summary).length, 320);
});

test("manual snapshots include every requested activity kind", () => {
  const entries = snapshotActivity({ commits: [{ sha: "abcdef1", html_url: "https://github.com/dericg/wahl/commit/abcdef1", commit: { message: "Commit", committer: { date: occurredAt } } }], issues: [{ number: 6, state: "open", title: "Issue", html_url: "https://github.com/dericg/wahl/issues/6", updated_at: occurredAt }], pulls: [{ number: 13, state: "closed", merged_at: occurredAt, updated_at: occurredAt, title: "PR", html_url: "https://github.com/dericg/wahl/pull/13" }], deployments: [{ id: 4, environment: "Production", created_at: occurredAt }], runs: [{ id: 5, run_attempt: 1, name: "CI", conclusion: "success", html_url: "https://github.com/dericg/wahl/actions/runs/5", updated_at: occurredAt }] });
  assert.deepEqual(new Set(entries.map((entry) => entry.kind)), new Set(["Commit", "Issue", "Pull request", "Deployment", "Workflow"]));
});

test("activity callback policy accepts only bounded Wahl records", () => {
  const valid = { sourceId: "issue:6:opened:2026-09-05T18:00:00Z", kind: "Issue", summary: "opened #6 · Activity", url: "https://github.com/dericg/wahl/issues/6", occurredAt };
  assert.equal(validateActivity(valid), null);
  assert.match(validateActivity({ ...valid, url: "https://example.com" }), /Wahl repository URL/);
  assert.match(validateActivity({ ...valid, kind: "Secret" }), /Unsupported/);
  assert.match(validateActivity({ ...valid, summary: "x".repeat(321) }), /between 1 and 320/);
});
