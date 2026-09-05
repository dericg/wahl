import test from "node:test";
import assert from "node:assert/strict";
import { commitEvents, issueEvents, deploymentEvents, workflowEvents, wallEntries, loadActivity } from "../src/activity.js";

const opened = "2026-09-04T12:00:00Z";
const closed = "2026-09-05T12:00:00Z";
const commit = { sha: "abcdef1234567890", commit: { committer: { date: opened }, message: "A small improvement\n\nDetails" } };
const issue = { number: 6, title: "Include repository activity", created_at: opened, closed_at: closed };

test("interleaves thoughts and repository activity by actual time, newest first", () => {
  const posts = [{ id: "thought", created_at: "2026-09-05T10:00:00Z", audience_type: "private", text: "A thought" }];
  const events = commitEvents([commit, { hash: "1234567", date: "2026-09-05T09:00:00-02:00", message: "Later commit" }]);
  const entries = wallEntries(posts, events);
  assert.deepEqual(entries.map((entry) => entry.id), ["github:commit:1234567", "thought", "github:commit:abcdef1234567890"]);
  assert.equal(entries[1].entryType, "thought");
  assert.equal(entries[1].audience_type, "private");
  assert.equal(entries[0].entryType, "activity");
  assert.equal(posts[0].entryType, undefined, "does not mutate stored posts");
  assert.equal(events[0].text, "A small improvement");
});

test("issues and PRs have distinct lifecycle events without duplicating PRs as issues", () => {
  const pull = { ...issue, pull_request: {}, merged_at: closed };
  assert.equal(issueEvents([pull]).length, 0);
  assert.deepEqual(issueEvents([issue]).map((entry) => entry.text), [
    "Opened #6 · Include repository activity", "Closed #6 · Include repository activity",
  ]);
  const events = issueEvents([pull], true);
  assert.match(events[1].text, /^Merged/);
  assert.equal(events[1].created_at, closed);
  assert.equal(events[1].url, "https://github.com/dericg/wahl/pull/6");
  assert.equal(new Set([...issueEvents([issue]), ...events].map((entry) => entry.id)).size, 4);
});

test("deployments use reported status, and workflow failures stay failures", () => {
  const events = deploymentEvents([{ id: 9, environment: "Production", created_at: opened, latestStatus: { id: 10, state: "failure", created_at: closed } }]);
  assert.deepEqual(events.map((entry) => entry.text), ["Production · requested", "Production · failure"]);
  assert.equal(events[1].created_at, closed);
  assert.equal(deploymentEvents([{ id: 9, created_at: opened }])[0].text, "Deployment · requested");
  const runs = workflowEvents([{ id: 11, name: "Build", status: "completed", conclusion: "failure", updated_at: closed }]);
  assert.equal(runs[0].text, "Build · failure");
  assert.equal(runs[0].url, "https://github.com/dericg/wahl/actions/runs/11");
});

test("ignores invalid dates and identifiers and keeps remote titles as bounded text", () => {
  assert.deepEqual(commitEvents([{ ...commit, sha: "javascript:alert(1)" }]), []);
  assert.deepEqual(commitEvents([{ ...commit, commit: { committer: { date: "invalid" } } }]), []);
  assert.deepEqual(issueEvents([{ ...issue, number: "../other" }]), []);
  const events = issueEvents([{ ...issue, title: "<script>" + "🌱".repeat(400), html_url: "javascript:alert(1)" }]);
  assert.equal(Array.from(events[0].text).length, 320);
  assert.match(events[0].text, /<script>/);
  assert.equal(events[0].url, "https://github.com/dericg/wahl/issues/6");
});

function response(data) { return { ok: true, json: async () => data }; }

test("loads all sources without credentials, including deployment status", async () => {
  const requests = [];
  const signal = new AbortController().signal;
  const result = await loadActivity({ signal, fetcher: async (url, options) => {
    requests.push(url);
    assert.equal(options.signal, signal);
    assert.equal(options.credentials, "omit");
    assert.deepEqual(options.headers, { Accept: "application/vnd.github+json" });
    assert.ok(url.startsWith("https://api.github.com/repos/dericg/wahl/"));
    if (url.includes("/commits?")) return response([commit]);
    if (url.includes("/issues?")) return response([issue]);
    if (url.includes("/pulls?")) return response([{ ...issue, merged_at: closed }]);
    if (url.includes("/deployments?")) return response([{ id: 9, created_at: opened }]);
    if (url.includes("/statuses?")) return response([{ id: 10, state: "success", created_at: closed }]);
    if (url.includes("/actions/runs?")) return response({ workflow_runs: [{ id: 11, created_at: closed, status: "queued" }] });
    assert.fail(`Unexpected request: ${url}`);
  } });
  assert.equal(result.unavailable, false);
  assert.equal(requests.length, 6);
  assert.deepEqual(new Set(result.events.map((entry) => entry.kind)), new Set(["Commit", "Issue", "Pull request", "Deployment", "Workflow"]));
});

test("source failures retain other activity and build commits", async () => {
  const result = await loadActivity({ fallbackCommits: [{ hash: "1234567", date: opened, message: "Built commit" }], fetcher: async (url) => {
    if (url.includes("/issues?")) return response([issue]);
    if (url.includes("/deployments?")) return response([{ id: 9, created_at: opened }]);
    return { ok: false, status: 403 };
  } });
  assert.equal(result.unavailable, true);
  assert.deepEqual(result.events.map((entry) => entry.kind), ["Commit", "Issue", "Issue", "Deployment"]);
  assert.equal(result.events[0].text, "Built commit");
  assert.match(result.events.at(-1).text, /requested$/);
});

test("network failure or cancellation resolves to fallback without rejecting", async () => {
  for (const error of [new Error("Offline"), new DOMException("Aborted", "AbortError")]) {
    const result = await loadActivity({ fetcher: async () => { throw error; } });
    assert.deepEqual(result, { events: [], unavailable: true });
  }
});
