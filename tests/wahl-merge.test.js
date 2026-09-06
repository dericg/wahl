import test from "node:test";
import assert from "node:assert/strict";
import { mergeReadiness, pullNumber, reviewOrMerge } from "../supabase/functions/_shared/wahl-merge.js";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const repo = { full_name: "dericg/wahl" };
function ready() {
  return {
    number: 35,
    pull: { number: 35, state: "open", draft: false, merged: false, mergeable: true, mergeable_state: "clean",
      head: { sha: headSha, repo }, base: { sha: baseSha, ref: "main", repo } },
    branch: { sha: baseSha }, comparison: { behind_by: 0 },
    runs: { workflow_runs: [{ id: 5, head_sha: headSha, event: "pull_request", path: ".github/workflows/ci.yml",
      repository: repo, pull_requests: [{ number: 35 }], status: "completed", conclusion: "success" }] },
    statuses: { statuses: [] },
  };
}
function context(overrides = {}) {
  return {
    owner: true, userId: "owner", post: { id: "thought", author_id: "owner", audience_type: "private", text: "#fix spacing" },
    automation: { post_id: "thought", pull_request_url: "https://github.com/dericg/wahl/pull/35" },
    input: { action: "review_pull_request" }, token: "server-only-test-token", ...overrides,
  };
}
function githubFixture(state = ready()) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    assert.ok(url.startsWith("https://api.github.com/repos/dericg/wahl/"));
    assert.equal(options.headers.Authorization, "Bearer server-only-test-token");
    let body;
    if (options.method === "POST" && url.endsWith("/actions/workflows/merge-reviewed-pr.yml/dispatches")) return new Response(null, { status: 204 });
    else if (url.endsWith("/pulls/35")) body = state.pull;
    else if (url.endsWith("/commits/main")) body = state.branch;
    else if (url.includes("/compare/")) body = state.comparison;
    else if (url.includes("/actions/workflows/ci.yml/runs?")) body = state.runs;
    else if (url.endsWith(`/commits/${headSha}/status`)) body = state.statuses;
    else assert.fail(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(body));
  } };
}
const mergeInput = { action: "merge_pull_request", headSha, baseSha, reviewed: true };

test("only canonical Wahl PR URLs are accepted", () => {
  assert.equal(pullNumber("https://github.com/dericg/wahl/pull/35"), 35);
  for (const url of [null, "https://github.com/other/wahl/pull/35", "https://github.com/dericg/wahl/pull/35/merge",
    "https://github.com/dericg/wahl/pull/35?redirect=1", "https://github.com/dericg/wahl/pull/0",
    "https://github.com/dericg/wahl/pull/9999999999999999999"]) assert.throws(() => pullNumber(url));
});

test("a successful trusted revision status can replace the suppressed PR workflow run", () => {
  const state = ready();
  state.runs = { workflow_runs: [] };
  state.statuses.statuses.push({ context: "wahl/revision-validation", state: "success" });
  assert.equal(mergeReadiness(state), null);
  state.statuses.statuses[0].state = "failure";
  assert.equal(typeof mergeReadiness(state), "string");
  state.statuses.statuses[0] = { context: "untrusted/status", state: "success" };
  assert.equal(typeof mergeReadiness(state), "string");
});

test("readiness requires an open, current, clean PR and successful Wahl tests/build", () => {
  assert.equal(mergeReadiness(ready()), null);
  const changes = [
    (s) => { s.pull.state = "closed"; }, (s) => { s.pull.merged = true; },
    (s) => { s.pull.draft = true; }, (s) => { s.pull.mergeable = null; },
    (s) => { s.pull.mergeable_state = "blocked"; }, (s) => { s.pull.mergeable_state = "unstable"; },
    (s) => { s.pull.base.ref = "another-branch"; }, (s) => { s.pull.head.repo = { full_name: "other/wahl" }; },
    (s) => { s.pull.number = 36; }, (s) => { s.comparison.behind_by = 1; },
    (s) => { s.comparison = {}; }, (s) => { s.branch.sha = "c".repeat(40); },
    (s) => { s.runs = {}; }, (s) => { s.runs.workflow_runs[0].head_sha = "c".repeat(40); },
    (s) => { s.runs.workflow_runs[0].conclusion = "failure"; },
    (s) => { s.runs.workflow_runs[0].status = "in_progress"; },
    (s) => { s.runs.workflow_runs[0].path = ".github/workflows/other.yml"; },
    (s) => { s.runs.workflow_runs[0].event = "workflow_dispatch"; },
    (s) => { s.runs.workflow_runs[0].pull_requests = [{ number: 36 }]; },
    (s) => { s.runs.workflow_runs.push({ ...s.runs.workflow_runs[0], id: 6, conclusion: "failure" }); },
  ];
  for (const change of changes) {
    const state = ready(); change(state);
    assert.equal(typeof mergeReadiness(state), "string", change.toString());
  }
});

test("owner and private post authorization fail before any GitHub request", async () => {
  const valid = context();
  for (const override of [
    { owner: false }, { owner: "true" }, { userId: null }, { post: null }, { automation: null },
    { post: { ...valid.post, author_id: "another-user" } },
    { post: { ...valid.post, audience_type: "everyone" } },
    { post: { ...valid.post, text: "regular thought" } },
    { automation: { ...valid.automation, post_id: "another-thought" } },
    { token: undefined }, { input: { action: "dispatch" } },
    { input: { ...mergeInput, reviewed: false } }, { input: { ...mergeInput, headSha: "bad" } },
  ]) {
    let called = false;
    await assert.rejects(reviewOrMerge(context({ ...override, fetchImpl: async () => { called = true; assert.fail(); } })));
    assert.equal(called, false);
  }
});

test("checking readiness never merges or exposes GitHub credentials", async () => {
  const fixture = githubFixture();
  const result = await reviewOrMerge(context(fixture));
  assert.equal(result.review.ready, true);
  assert.equal(result.review.headSha, headSha);
  assert.equal(fixture.calls.every((call) => call.method === "GET"), true);
  assert.equal(JSON.stringify(result).includes("server-only-test-token"), false);
});

test("explicit review rechecks readiness and dispatches only the approved commits", async () => {
  const fixture = githubFixture();
  const result = await reviewOrMerge(context({ ...fixture, input: mergeInput }));
  assert.equal(result.review.merged, false);
  assert.equal(result.review.ready, false);
  const writes = fixture.calls.filter((call) => call.method === "POST");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, "https://api.github.com/repos/dericg/wahl/actions/workflows/merge-reviewed-pr.yml/dispatches");
  assert.deepEqual(JSON.parse(writes[0].body), { ref: "main", inputs: {
    pull_request_number: "35", head_sha: headSha, base_sha: baseSha,
  } });
});

test("changed commits, changed main, and failed checks block a previously reviewed merge", async () => {
  for (const change of [
    (s) => { s.pull.head.sha = "c".repeat(40); s.runs.workflow_runs[0].head_sha = s.pull.head.sha; },
    (s) => { s.branch.sha = "c".repeat(40); s.pull.base.sha = s.branch.sha; },
    (s) => { s.runs.workflow_runs[0].conclusion = "failure"; },
    (s) => { s.pull.state = "closed"; },
  ]) {
    const state = ready(); change(state);
    const fixture = githubFixture(state);
    await assert.rejects(reviewOrMerge(context({ ...fixture, input: mergeInput })));
    assert.equal(fixture.calls.some((call) => call.method === "POST"), false);
  }
});

test("GitHub read and dispatch errors cannot report success", async () => {
  await assert.rejects(reviewOrMerge(context({ fetchImpl: async () => new Response("denied", { status: 403 }) })), /unavailable/);
  const conflict = githubFixture();
  await assert.rejects(reviewOrMerge(context({ input: mergeInput, fetchImpl: (url, options) =>
    options.method === "POST" ? Promise.resolve(new Response("denied", { status: 403 })) : conflict.fetchImpl(url, options),
  })), /did not accept the merge request/);
});
