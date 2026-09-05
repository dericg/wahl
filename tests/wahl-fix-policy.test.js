import test from "node:test";
import assert from "node:assert/strict";
import { validateFixRequest } from "../supabase/functions/_shared/wahl-fix-policy.js";

const userId = "owner-id";
const eligiblePost = { author_id: userId, audience_type: "private", text: "#fix tighten the spacing" };

test("accepts an owner's private #fix thought", () => {
  assert.equal(validateFixRequest({ owner: true, userId, post: eligiblePost }), null);
});

test("rejects a user who is not the Wahl owner", () => {
  assert.deepEqual(validateFixRequest({ owner: false, userId, post: eligiblePost }), {
    error: "Owner access required",
    status: 403,
  });
});

test("rejects public, foreign, and untagged thoughts", () => {
  for (const post of [
    { ...eligiblePost, audience_type: "everyone" },
    { ...eligiblePost, author_id: "another-user" },
    { ...eligiblePost, text: "tighten the spacing" },
  ]) {
    assert.equal(validateFixRequest({ owner: true, userId, post })?.status, 400);
  }
});
