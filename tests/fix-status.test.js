import test from "node:test";
import assert from "node:assert/strict";
import { fixPresentation, hasActiveFix } from "../src/fixStatus.js";
import { validateAutomationUpdate } from "../supabase/functions/_shared/wahl-fix-status.js";

const requestId = "31f3ebca-e795-48f2-81d9-102b4cfe1290";

test("presents every automation state in plain language", () => {
  assert.equal(fixPresentation("queued").label, "Sent to Codex");
  assert.equal(fixPresentation("working").label, "Codex is working");
  assert.equal(fixPresentation("pr_ready").label, "Pull request ready");
  assert.equal(fixPresentation("no_change").label, "No change proposed");
  assert.equal(fixPresentation("failed").label, "Needs attention");
  assert.equal(fixPresentation("closed").label, "Pull request closed");
});

test("polls only while at least one request is active", () => {
  assert.equal(hasActiveFix({ one: { status: "queued" } }), true);
  assert.equal(hasActiveFix({ one: { status: "working" }, two: { status: "pr_ready" } }), true);
  assert.equal(hasActiveFix({ one: { status: "pr_ready" }, two: { status: "failed" } }), false);
});

test("accepts trusted workflow status payloads", () => {
  for (const status of ["working", "no_change", "failed"]) {
    assert.equal(validateAutomationUpdate({ requestId, status }), null);
  }
  assert.equal(validateAutomationUpdate({ requestId, status: "pr_ready", pullRequestUrl: "https://github.com/dericg/wahl/pull/12" }), null);
});

test("rejects invalid identifiers, statuses, and pull request URLs", () => {
  assert.equal(validateAutomationUpdate({ requestId: "not-an-id", status: "working" })?.status, 400);
  assert.equal(validateAutomationUpdate({ requestId, status: "closed" })?.status, 400);
  assert.equal(validateAutomationUpdate({ requestId, status: "pr_ready" })?.status, 400);
  assert.equal(validateAutomationUpdate({ requestId, status: "pr_ready", pullRequestUrl: "https://example.com/pull/1" })?.status, 400);
  assert.equal(validateAutomationUpdate({ requestId, status: "failed", pullRequestUrl: "https://github.com/dericg/wahl/pull/12" })?.status, 400);
});
