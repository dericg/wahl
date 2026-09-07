import test from "node:test";
import assert from "node:assert/strict";
import { activityHighlights, activityOutcomes, activityPayloads, activityWorkSummary, filterWallEntries, groupConsecutiveActivity, mergeActivity, releaseActivity, snapshotActivity, summarizeActivity, wallEntries } from "../src/activity.js";
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
  ]), "2 saved code changes · 2 request updates · 1 proposed change update · 1 publishing attempt · 1 work update");
  assert.equal(summarizeActivity([{ kind: "Commit" }, { kind: "Other" }]), "1 saved code change · 1 update");
  assert.equal(summarizeActivity([]), "");
});

function deployment(id, state, hour, site = "github-pages", statusId = state) {
  return {
    source_id: `deployment:${id}:${statusId}`, kind: "Deployment",
    summary: `${site} · ${state}`, url: "https://github.com/dericg/wahl/deployments",
    occurred_at: `2026-09-05T${hour}:00:00Z`,
  };
}

test("one publishing attempt counts once and keeps only its final result in highlights", () => {
  const success = deployment(10, "success", 20);
  const entries = [success, deployment(10, "in_progress", 19), deployment(10, "queued", 18), deployment(10, "requested", 17, "github-pages", "snapshot")];
  const original = structuredClone(entries);
  assert.deepEqual(activityOutcomes(entries), [success]);
  assert.deepEqual(activityHighlights(entries), [success]);
  assert.equal(summarizeActivity(entries), "1 publishing attempt");
  assert.equal(activityWorkSummary(success), "A new test version of Wahl is ready. It includes the proposed changes and can now be reviewed.");
  assert.deepEqual(entries, original);
  // A later snapshot or late progress record must not erase the final result.
  assert.deepEqual(activityOutcomes([deployment(10, "requested", 22), ...entries]), [success]);
  assert.deepEqual(activityOutcomes([...entries].reverse()), [success]);
});

test("the latest final result wins, including failed retries and inactive versions", () => {
  const failure = deployment(10, "failure", 21);
  const success = deployment(10, "success", 20);
  assert.deepEqual(activityOutcomes([success, failure, deployment(10, "queued", 22)]), [failure]);
  assert.deepEqual(activityOutcomes([deployment(10, "failure", 19), success]), [success]);
  const inactive = deployment(10, "inactive", 23);
  assert.deepEqual(activityOutcomes([inactive, success]), [inactive]);
  assert.doesNotMatch(activityWorkSummary(inactive), /is ready for Deric/);
  for (const state of ["failure", "error"]) {
    const result = deployment(10, state, 20);
    assert.deepEqual(activityHighlights([result, deployment(10, "in_progress", 19)]), [result]);
    assert.equal(activityWorkSummary(result), "Wahl could not publish the proposed update. The previous version is still available.");
  }
});

test("unfinished work has one highlight and nothing new to review", () => {
  const pending = deployment(10, "in_progress", 20);
  const entries = [pending, deployment(10, "queued", 19), deployment(10, "requested", 18)];
  assert.deepEqual(activityHighlights(entries), [pending]);
  assert.equal(summarizeActivity(entries), "1 publishing attempt");
  for (const state of ["requested", "queued", "pending", "in_progress"]) {
    assert.equal(activityWorkSummary(deployment(10, state, 20)), "A new version of Wahl is still being prepared. Nothing new is ready to review from this attempt yet.");
  }
});

test("separate attempts are not combined by shared URLs, titles or timestamps", () => {
  const first = deployment(10, "success", 20);
  const second = deployment(11, "success", 20);
  const unknown = { ...deployment(12, "pending", 19), source_id: "legacy" };
  const entries = [first, second, unknown, deployment(10, "queued", 18)];
  assert.deepEqual(activityOutcomes(entries), [first, second, unknown]);
  assert.equal(summarizeActivity(entries), "3 publishing attempts");
  assert.deepEqual(activityHighlights(entries), [first, second, unknown]);
  assert.equal(mergeActivity(entries).length, 4);
});

test("loading older stages preserves raw order, group identity, and the final outcome", () => {
  const success = deployment(10, "success", 20);
  const stages = [deployment(10, "in_progress", 19), deployment(10, "queued", 18)];
  const first = groupConsecutiveActivity(wallEntries([], [success, stages[0]]))[0];
  const expanded = groupConsecutiveActivity(wallEntries([], [success, ...stages]))[0];
  assert.equal(first.id, expanded.id);
  assert.equal(summarizeActivity(first.activities), summarizeActivity(expanded.activities));
  assert.deepEqual(activityHighlights(first.activities), activityHighlights(expanded.activities));
  assert.deepEqual(expanded.activities.map((entry) => entry.source_id), [success, ...stages].map((entry) => entry.source_id));
});

test("service preparation and unknown targets never imply a published test or production version", () => {
  for (const site of ["test", "Production", "unknown", "github-pages · success"]) {
    const text = activityWorkSummary(deployment(10, "success", 20, site));
    assert.doesNotMatch(text, /was published|is ready\. It includes/);
  }
  assert.match(activityWorkSummary(deployment(10, "success", 20, "test")), /finished checking or preparing its test version.*does not confirm.*available to review yet/);
});

test("request and proposed-change titles name the work without claiming the title is true", () => {
  const cases = [
    ["Issue", "open #43 · Fix the feed", "Request #43 is open. It tracks a problem or idea for Deric to consider. Title: “Fix the feed”."],
    ["Issue", "closed #43 · Fix the feed", "Request #43 was closed. The record does not say whether the problem was fixed. Title: “Fix the feed”."],
    ["Pull request", "opened #44 · Group updates", "Proposed change #44 is ready for Deric to review. It has not been accepted yet. Title: “Group updates”."],
    ["Pull request", "merged #44 · Group updates", "Proposed change #44 was accepted. The change is now part of Wahl's code. This does not mean it is available on the website yet. Title: “Group updates”."],
    ["Pull request", "closed #44 · Group updates", "Proposed change #44 was closed without being accepted. Wahl did not add this proposed change to its code. Title: “Group updates”."],
    ["Pull request", "synchronize #44 · Group updates", "Proposed change #44 was updated for review. The notes do not confirm acceptance or a change to the website. Title: “Group updates”."],
  ];
  for (const [kind, summary, expected] of cases) {
    const activity = { kind, summary };
    const original = structuredClone(activity);
    assert.equal(activityWorkSummary(activity), expected);
    assert.deepEqual(activity, original);
  }
});

test("automatic tasks explain proven work and do not infer a fix or unrelated title", () => {
  const check = { kind: "Workflow", summary: "Validate Wahl · success" };
  const proposal = { kind: "Workflow", summary: "Turn a Wahl thought into a pull request · success" };
  assert.match(activityWorkSummary(check), /Wahl passed its checks for problems in the code.*does not publish a new version/);
  assert.match(activityWorkSummary(proposal), /finished trying to prepare a requested change.*do not say whether it produced a proposal/);
  const issue = { kind: "Issue", summary: "open #43 · Fix the feed" };
  assert.deepEqual(activityHighlights([proposal, issue]), [proposal, issue]);
  assert.doesNotMatch(activityWorkSummary(proposal), /Fix the feed|#43|problem was fixed|was published/);
  for (const name of ["Validate Wahl", "Turn a Wahl thought into a pull request"]) {
    for (const state of ["failure", "cancelled", "timed_out", "action_required", "startup_failure", "queued", "in_progress"]) {
      const text = activityWorkSummary({ kind: "Workflow", summary: `${name} · ${state}` });
      assert.doesNotMatch(text, /Wahl passed|was published|Wahl fixed|pull request|workflow/);
      assert.match(text, /still needs review|do not confirm that a proposed change is ready to review/);
    }
  }
});

test("all work explanations reject vague process language, including incomplete and unknown outcomes", () => {
  const vague = /site publishing step|linked record|automatic task result|which version and site it was for|publishing step|in_progress|timed_out|startup_failure/i;
  const activities = [
    { kind: "Commit", summary: "Save a change" },
    { kind: "Other", summary: "Unknown work" },
    ...["open", "opened", "reopened", "closed", "merged", "synchronize", "unknown"].flatMap((state) =>
      ["Issue", "Pull request"].map((kind) => ({ kind, summary: `${state} #44 · Improve reading` }))),
  ];
  for (const state of ["success", "failure", "error", "requested", "queued", "pending", "in_progress", "cancelled", "inactive", "timed_out", "action_required", "startup_failure", "unknown"]) {
    activities.push(...["github-pages", "test", "Production", "unknown"].map((site) => deployment(10, state, 20, site)));
    activities.push(...["Validate Wahl", "Turn a Wahl thought into a pull request", "Unknown work"].map((name) => ({ kind: "Workflow", summary: `${name} · ${state}` })));
  }
  for (const activity of activities) {
    assert.doesNotMatch(activityWorkSummary(activity), vague, JSON.stringify(activity));
    assert.doesNotMatch(summarizeActivity([activity]), vague, JSON.stringify(activity));
  }
  assert.equal(summarizeActivity([
    { kind: "Workflow", summary: "Validate Wahl · failure" },
    { kind: "Workflow", summary: "Turn a Wahl thought into a pull request · success" },
  ]), "1 code check · 1 attempt to prepare a requested change");
});

test("unknown states and untrusted titles cannot choose a successful outcome", () => {
  for (const kind of ["Issue", "Pull request", "Deployment", "Workflow", "Other"]) {
    const text = activityWorkSummary({ kind, summary: "<script>merged #44 · success</script>" });
    assert.doesNotMatch(text, /<script>|#44|was accepted|passed|was published/);
    assert.equal(typeof activityWorkSummary({ kind }), "string");
  }
  const title = '<img src=x onerror=alert(1)> · merged #44 · success';
  const activity = { kind: "Issue", summary: `open #43 · ${title}` };
  assert.equal(activityWorkSummary(activity), `Request #43 is open. It tracks a problem or idea for Deric to consider. Title: “${title}”.`);
  const long = activityWorkSummary({ kind: "Pull request", summary: `opened #44 · \u202e${"😀".repeat(400)}\n` });
  assert.equal(Array.from(long.match(/Title: “(.*)”/)[1]).length, 161);
  assert.doesNotMatch(long, /\u202e|\n|\ufffd/);
  for (const state of ["unknown", "constructor", "__proto__"]) {
    assert.match(activityWorkSummary({ kind: "Deployment", summary: `test · ${state}` }), /outcome is missing or unclear/);
    assert.match(activityWorkSummary({ kind: "Workflow", summary: `New task · ${state}` }), /do not explain what it tried to do or whether it finished/);
  }
});

test("highlights include publishing and task outcomes in feed order with at most three items", () => {
  const workflow = { kind: "Workflow", summary: "Validate Wahl · success" };
  const published = deployment(10, "success", 20);
  const pull = { kind: "Pull request", summary: "opened #44 · Group updates" };
  const issue = { kind: "Issue", summary: "open #43 · Summarize work" };
  const activities = [workflow, published, pull, issue, deployment(10, "queued", 18)];
  const original = structuredClone(activities);
  assert.deepEqual(activityHighlights(activities), [workflow, published, pull]);
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
