import assert from "node:assert/strict";
import test from "node:test";
import { deriveBrief, briefThought } from "../supabase/functions/_shared/wahl-brief.js";
import { createBriefReview, requestConfirmedChange } from "../src/briefReview.js";

function setup(generate) {
  const states = [];
  const posts = [];
  const dispatches = [];
  const flow = createBriefReview({
    generate,
    onChange: (state) => states.push(state),
    onRequest: (text) => requestConfirmedChange(text, {
      addPost: async (post) => { posts.push(post); return { id: "private-post" }; },
      sendFix: async (id) => { dispatches.push(id); return true; },
    }),
  });
  return { flow, posts, dispatches, state: () => states.at(-1) };
}

for (const [mode, content, text] of [
  ["research", "Would passkeys work with our existing sign-in?", "Research whether passkeys fit the existing sign-in; explain tradeoffs without implementation."],
  ["planning", "Outline a plan first. Don't change authentication.", "Plan the sign-in improvements while keeping authentication unchanged."],
]) {
  test(`${mode} questions produce an editable brief without creating automation`, async () => {
    const messages = [{ role: "user", content }];
    const { flow, posts, dispatches, state } = setup((history) => deriveBrief(history, async (request) => {
      assert.deepEqual(request.messages, messages);
      assert.match(request.instructions, /Questions about feasibility, comparisons, or how something works are research/);
      assert.match(request.instructions, /Use implementation only when the owner has explicitly asked/);
      return JSON.stringify({ mode, text });
    }));
    await flow.prepare(messages);
    assert.equal(state().brief.mode, mode);
    assert.equal(state().brief.text, text);
    await flow.confirm();
    flow.edit("Implement the suggestion");
    await flow.confirm(); // Editing text cannot promote research to implementation.
    assert.deepEqual(posts, []);
    assert.deepEqual(dispatches, []);
    flow.cancel();
    assert.equal(state().brief, null);
  });
}

test("implementation preparation supplies the conversation and waits for explicit confirmation", async () => {
  const messages = [
    { role: "user", content: "Add a way to review the bot's request before it starts. Keep authentication unchanged." },
    { role: "assistant", content: "We can show an editable brief with confirmation and cancellation." },
    { role: "user", content: "Implement that, keeping research separate." },
  ];
  const brief = { mode: "implementation", text: "Add an editable conversation-aware brief with confirmation and cancellation before bot automation. Keep research separate and authentication unchanged." };
  const { flow, posts, dispatches, state } = setup((history) => deriveBrief(history, async (request) => {
    assert.deepEqual(request.messages, messages);
    assert.match(request.instructions, /earlier goals, constraints, decisions, and the latest corrections/);
    return JSON.stringify(brief);
  }));
  await flow.prepare(messages);
  assert.deepEqual(state().brief, brief);
  assert.deepEqual(posts, []);
  assert.deepEqual(dispatches, []);
  await flow.confirm();
  assert.deepEqual(posts, [{ text: briefThought(brief), audience: "private" }]);
  assert.deepEqual(dispatches, ["private-post"]);
  await flow.confirm();
  assert.equal(posts.length, 1);
});

test("editing hands off exactly the displayed text, preserving whitespace, Unicode and punctuation", async () => {
  const { flow, posts, state } = setup(async () => ({ mode: "implementation", text: "Original draft" }));
  await flow.prepare([]);
  const edit = " Keep sign-in unchanged.\nAdd **review** & cancellation — 🪴. ";
  flow.edit(edit);
  const displayedText = briefThought(state().brief);
  assert.equal(displayedText, `#fix ${edit}`);
  assert.deepEqual(posts, []);
  await flow.confirm();
  assert.equal(posts[0].text, displayedText);
});

test("cancellation discards prepared and late-arriving briefs", async () => {
  let resolve;
  const { flow, posts, state } = setup(() => new Promise((done) => { resolve = done; }));
  const pending = flow.prepare([]);
  flow.cancel();
  resolve({ mode: "implementation", text: "A cancelled request" });
  await pending;
  await flow.confirm();
  assert.equal(state().brief, null);
  assert.deepEqual(posts, []);
  const next = flow.prepare([]);
  resolve({ mode: "implementation", text: "Another request" });
  await next;
  flow.edit("An edited request");
  flow.cancel();
  await flow.confirm();
  assert.deepEqual(posts, []);
});

test("a superseded generation cannot replace the current brief", async () => {
  const resolutions = [];
  const { flow, state } = setup(() => new Promise((resolve) => resolutions.push(resolve)));
  const old = flow.prepare([]);
  const current = flow.prepare([]);
  resolutions[1]({ mode: "planning", text: "Current scope" });
  await current;
  resolutions[0]({ mode: "implementation", text: "Stale scope" });
  await old;
  assert.equal(state().brief.text, "Current scope");
});

test("invalid and oversized edits fail closed instead of truncating", async () => {
  const { flow, posts } = setup(async () => ({ mode: "implementation", text: "Valid draft" }));
  await flow.prepare([]);
  for (const text of ["", "   ", "x".repeat(316), "#fix duplicate prefix"]) {
    flow.edit(text);
    await flow.confirm();
    assert.deepEqual(posts, []);
  }
  flow.edit("🪴".repeat(315));
  await flow.confirm();
  assert.equal([...posts[0].text].length, 320);
});

test("malformed model output never becomes an actionable brief", async () => {
  for (const output of ["not JSON", "null", '{"mode":"implement","text":"Do it"}', JSON.stringify({ mode: "implementation", text: "x".repeat(316) })]) {
    const { flow, posts, state } = setup((messages) => deriveBrief(messages, async () => output));
    await flow.prepare([{ role: "user", content: "Implement the change" }]);
    await flow.confirm();
    assert.equal(state().status, "idle");
    assert.ok(state().error);
    assert.deepEqual(posts, []);
  }
  await assert.rejects(deriveBrief([], () => assert.fail("No generation without conversation")));
});

test("confirmation is consumed before asynchronous side effects and failures do not silently retry", async () => {
  let finish;
  let calls = 0;
  let state;
  const flow = createBriefReview({
    generate: async () => ({ mode: "implementation", text: "Reviewed request" }),
    onChange: (next) => { state = next; },
    onRequest: () => { calls++; return new Promise((resolve) => { finish = resolve; }); },
  });
  await flow.prepare([]);
  const pending = flow.confirm();
  await flow.confirm();
  flow.edit("Changed mid-flight");
  flow.cancel();
  assert.equal(calls, 1);
  assert.equal(state.brief.text, "Reviewed request");
  finish(false);
  await pending;
  await flow.confirm();
  assert.equal(calls, 1);
  assert.equal(state.brief, null);
  assert.match(state.error, /Check its private thought/);
});

test("a rejected private post never dispatches automation", async () => {
  assert.equal(await requestConfirmedChange("#fix Valid request", {
    addPost: async () => false,
    sendFix: () => assert.fail("Must not dispatch without a private post"),
  }), false);
});
