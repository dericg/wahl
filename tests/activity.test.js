import test from "node:test";
import assert from "node:assert/strict";
import { activityHighlights, activityPayloads, filterWallEntries, groupConsecutiveActivity, mergeActivity, releaseActivity, snapshotActivity, summarizeActivity, wallEntries } from "../src/activity.js";
import { normalizeActivity, validateActivity } from "../supabase/functions/_shared/wahl-activity-policy.js";

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

test("only consecutive Wahl entries collapse, preserving thoughts and original order", () => {
  const activity = Array.from({ length: 5 }, (_, index) => ({
    source_id: `commit:${index}`, kind: "Commit", summary: `Change ${index}`,
    occurred_at: `2026-09-05T${20 - index}:00:00Z`,
  }));
  const posts = [
    { id: "public", text: "Wahl", audience_type: "everyone", created_at: "2026-09-05T18:30:00Z" },
    { id: "private", text: "A private thought", audience_type: "private", created_at: "2026-09-05T16:30:00Z" },
  ];
  const entries = wallEntries(posts, activity);
  const original = structuredClone(entries);
  const grouped = groupConsecutiveActivity(entries);
  assert.deepEqual(grouped.map((entry) => entry.entry_type), ["activity-group", "thought", "activity-group", "thought", "activity"]);
  assert.deepEqual(grouped.flatMap((entry) => entry.activities || [entry]), entries);
  assert.equal(grouped[0].created_at, entries[0].created_at);
  assert.deepEqual(entries, original);
  assert.deepEqual(groupConsecutiveActivity([]), []);
  assert.deepEqual(groupConsecutiveActivity([entries[0]]), [entries[0]]);
});

test("loading more entries extends a trailing group without changing its identity", () => {
  const entries = wallEntries([], releaseActivity([
    { hash: "abcdef1", date: "2026-09-05T20:00:00Z", message: "Newest" },
    { hash: "abcdef2", date: "2026-09-05T19:00:00Z", message: "Middle" },
    { hash: "abcdef3", date: "2026-09-05T18:00:00Z", message: "Oldest" },
  ]));
  const firstPage = groupConsecutiveActivity(entries.slice(0, 2));
  const nextPage = groupConsecutiveActivity(entries);
  assert.equal(nextPage[0].id, firstPage[0].id);
  assert.equal(firstPage[0].activities.length, 2);
  assert.deepEqual(nextPage[0].activities, entries);
});

test("combined summary counts event kinds without inventing lifecycle outcomes", () => {
  assert.equal(summarizeActivity([
    { kind: "Commit" }, { kind: "Issue", summary: "open #43" },
    { kind: "Commit" }, { kind: "Issue", summary: "closed #43" },
    { kind: "Pull request" }, { kind: "Deployment" }, { kind: "Workflow" },
  ]), "2 commits · 2 issue updates · 1 pull request update · 1 deployment update · 1 workflow result");
});

test("work highlights surface up to three distinct changes ahead of workflow noise", () => {
  const workflow = { kind: "Workflow", summary: "Validate Wahl · success" };
  const commit = { kind: "Commit", summary: "Keep the header visible" };
  const pull = { kind: "Pull request", summary: "opened #44 · Group repository updates" };
  const issue = { kind: "Issue", summary: "open #43 · Summarize work" };
  const older = { kind: "Commit", summary: "Improve spacing" };
  const activities = [workflow, commit, { ...commit }, pull, issue, older];
  const original = structuredClone(activities);
  assert.deepEqual(activityHighlights(activities), [commit, pull, issue]);
  assert.deepEqual(activities, original);
  assert.deepEqual(activityHighlights([workflow, workflow]), [workflow]);
  assert.deepEqual(activityHighlights([]), []);
});

test("issues filter returns one entry per issue", () => {
  const entries = [
    { id: "thought", entry_type: "thought" },
    { id: "github:issue:6", entry_type: "activity", kind: "Issue" },
    { id: "github:issue:6:older", entry_type: "activity", kind: "Issue" },
    { id: "github:pr:15", entry_type: "activity", kind: "Pull request" },
  ];
  entries[1].created_at = entries[2].created_at = occurredAt;
  entries[1].url = entries[2].url = "https://github.com/dericg/wahl/issues/6";
  assert.deepEqual(filterWallEntries(entries, "issues"), [entries[1]]);
  assert.equal(filterWallEntries(entries, "all"), entries);
});

test("GitHub events normalize without trusting deployment target URLs", () => {
  const issue = activityPayloads("issues", { repository, action: "opened", issue: { number: 6, title: "Activity", html_url: "https://github.com/dericg/wahl/issues/6", updated_at: occurredAt } });
  assert.equal(issue[0].summary, "open #6 · Activity");
  const deployment = activityPayloads("deployment_status", { repository, deployment: { id: 2, environment: "Production" }, deployment_status: { id: 3, state: "success", target_url: "https://evil.example", created_at: occurredAt } });
  assert.equal(deployment[0].url, "https://github.com/dericg/wahl/deployments");
  assert.deepEqual(activityPayloads("issues", { repository: { full_name: "other/repo" } }), []);
  assert.equal(Array.from(activityPayloads("push", { repository, ref: "refs/heads/main", commits: [{ id: "a".repeat(40), message: "x".repeat(400), timestamp: occurredAt }] })[0].summary).length, 320);
});

test("manual snapshots include every requested activity kind", () => {
  const entries = snapshotActivity({ commits: [{ sha: "abcdef1", html_url: "https://github.com/dericg/wahl/commit/abcdef1", commit: { message: "Commit", committer: { date: occurredAt } } }], issues: [{ number: 6, state: "open", title: "Issue", html_url: "https://github.com/dericg/wahl/issues/6", updated_at: occurredAt }], pulls: [{ number: 13, state: "closed", merged_at: occurredAt, updated_at: occurredAt, title: "PR", html_url: "https://github.com/dericg/wahl/pull/13" }], deployments: [{ id: 4, environment: "Production", created_at: occurredAt }], runs: [{ id: 5, run_attempt: 1, name: "Validate Wahl", status: "completed", conclusion: "success", html_url: "https://github.com/dericg/wahl/actions/runs/5", updated_at: occurredAt }] });
  assert.deepEqual(new Set(entries.map((entry) => entry.kind)), new Set(["Commit", "Issue", "Pull request", "Deployment", "Workflow"]));
});

test("activity callback policy accepts only bounded Wahl records", () => {
  const valid = { sourceId: "issue:6:opened:2026-09-05T18:00:00Z", kind: "Issue", summary: "opened #6 · Activity", url: "https://github.com/dericg/wahl/issues/6", occurredAt };
  assert.equal(validateActivity(valid), null);
  assert.match(validateActivity({ ...valid, url: "https://example.com" }), /Wahl repository URL/);
  assert.match(validateActivity({ ...valid, kind: "Secret" }), /Unsupported/);
  assert.match(validateActivity({ ...valid, summary: "x".repeat(321) }), /between 1 and 320/);
});


test("issue lifecycle history stays in All while issues show their newest known state", () => {
  const url = "https://github.com/dericg/wahl/issues/6";
  const old = { source_id: "old", kind: "Issue", summary: "open #6", url, occurred_at: occurredAt };
  const newest = { ...old, source_id: "new", summary: "closed #6", occurred_at: "2026-09-06T18:00:00Z" };
  const entries = wallEntries([], [old, newest]);
  assert.equal(filterWallEntries(entries, "all").length, 2);
  assert.deepEqual(filterWallEntries([...entries].reverse(), "issues").map((entry) => entry.summary), ["closed #6"]);
  const anotherPage = wallEntries([], [old, newest, { ...old, source_id: "snapshot", url: url + "/" }]);
  assert.equal(filterWallEntries(anotherPage, "issues").length, 1);
});

test("historical issue backfills and live callbacks share stable update identities", () => {
  const issue = { number: 6, state: "open", title: "Issue", html_url: "https://github.com/dericg/wahl/issues/6", updated_at: occurredAt };
  const [live] = activityPayloads("issues", { repository, action: "reopened", issue });
  const [snapshot] = snapshotActivity({ issues: [issue] });
  assert.deepEqual(live, snapshot);
  assert.equal(live.sourceId, "issue:6:2026-09-05T18:00:00.000Z");
  assert.deepEqual(snapshotActivity({ issues: [{ ...issue, pull_request: {} }] }), []);
});

test("live and historical ingestion omit internal, unfinished and skipped workflows", () => {
  const run = { id: 42, name: "Validate Wahl", status: "completed", conclusion: "success", html_url: "https://github.com/dericg/wahl/actions/runs/42", updated_at: occurredAt };
  for (const change of [
    { name: "Record Wahl repository activity" }, { name: "Unrelated workflow" },
    { status: "in_progress", conclusion: null }, { status: "queued", conclusion: null }, { conclusion: "skipped" },
  ]) {
    assert.deepEqual(activityPayloads("workflow_run", { repository, workflow_run: { ...run, ...change } }), []);
    assert.deepEqual(snapshotActivity({ runs: [{ ...run, ...change }] }), []);
  }
  const [first] = snapshotActivity({ runs: [run] });
  const [retry] = snapshotActivity({ runs: [{ ...run, run_attempt: 2 }] });
  assert.equal(first.sourceId, "workflow:42");
  assert.equal(first.sourceId, retry.sourceId);
  assert.equal(normalizeActivity({ ...first, summary: "Record Wahl repository activity · success" }), null);
});

test("display reconciles legacy workflow attempts and hides unfinished records", () => {
  const old = { source_id: "workflow:42:1", kind: "Workflow", url: "https://github.com/dericg/wahl/actions/runs/42", summary: "Validate Wahl · failure", occurred_at: occurredAt };
  const newest = { ...old, source_id: "workflow:42:2", summary: "Validate Wahl · success", occurred_at: "2026-09-06T18:00:00Z" };
  const progress = { ...newest, source_id: "workflow:42:3", summary: "Validate Wahl · in_progress" };
  const noise = { ...newest, source_id: "workflow:43", summary: "Record Wahl repository activity · success" };
  assert.deepEqual(mergeActivity([newest, progress, noise, old]), [newest]);
});
