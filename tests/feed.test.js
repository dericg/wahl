import test from "node:test";
import assert from "node:assert/strict";
import { appendPosts, feedSource, loadFeedPage, timestampKey } from "../src/feed.js";
import { filterWallEntries, mergeActivity, wallEntries } from "../src/activity.js";
import { exactTime, timeAgo } from "../src/time.js";

const date = (seconds) => new Date(Date.UTC(2026, 8, 6, 0, 0, seconds)).toISOString();
const post = (id, time) => ({ id, created_at: time, text: id, audience_type: "everyone" });
const event = (id, time) => ({ source_id: id, occurred_at: time, kind: "Issue", url: `https://github.com/dericg/wahl/issues/${id}`, summary: id });

function source(rows, thought, calls = []) {
  const id = thought ? "id" : "source_id";
  const time = thought ? "created_at" : "occurred_at";
  return async (cursor, limit) => {
    calls.push(limit);
    return rows.filter((row) => !cursor || timestampKey(row[time]) < timestampKey(cursor[time]) ||
      (timestampKey(row[time]) === timestampKey(cursor[time]) && row[id] > cursor[id]))
      .sort((a, b) => timestampKey(b[time]).localeCompare(timestampKey(a[time])) || a[id].localeCompare(b[id])).slice(0, limit);
  };
}

test("bounded combined pages have no gaps across skewed sources and timestamp ties", async () => {
  const posts = Array.from({ length: 61 }, (_, i) => post(`p${String(i).padStart(3, "0")}`, date(Math.floor(i / 3))));
  const activity = Array.from({ length: 87 }, (_, i) => event(`a${String(i).padStart(3, "0")}`, date(Math.floor(i / 2) - 25)));
  const calls = [];
  let cursor;
  let all = [];
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await loadFeedPage({ loadPosts: source(posts, true, calls), loadActivity: source(activity, false, calls), cursor });
    const entries = wallEntries(page.posts, page.activity);
    assert.ok(entries.length <= 20);
    all.push(...entries);
    cursor = page.cursor;
    if (!page.hasMore) break;
  }
  assert.equal(all.length, 148);
  assert.equal(new Set(all.map((entry) => entry.id)).size, 148);
  assert.ok(calls.every((limit) => limit === 21));
  assert.ok(all.every((entry, i) => !i || timestampKey(all[i - 1].created_at) >= timestampKey(entry.created_at)));
});

test("cursor retains microseconds and consumes the database order within each source", async () => {
  const posts = [post("a", "2026-09-06T00:00:00.000002+00:00"), post("b", "2026-09-06T00:00:00.000001+00:00")];
  const activity = [event("c", "2026-09-06T00:00:00.000001Z")];
  const loadPosts = source(posts, true);
  const loadActivity = source(activity, false);
  const first = await loadFeedPage({ loadPosts, loadActivity, limit: 1 });
  const second = await loadFeedPage({ loadPosts, loadActivity, cursor: first.cursor, limit: 1 });
  const third = await loadFeedPage({ loadPosts, loadActivity, cursor: second.cursor, limit: 1 });
  assert.equal(first.posts[0].id, "a");
  assert.equal(second.posts[0].id, "b");
  assert.equal(third.activity[0].source_id, "c");
  assert.equal(third.hasMore, false);
  assert.equal(timestampKey("2026-09-06T02:00:00.123456+02:00"), timestampKey("2026-09-06T00:00:00.123456Z"));
});

test("inserts and deletes before a cursor do not shift subsequent pages", async () => {
  const posts = [post("new", date(30)), post("middle", date(20)), post("old", date(10))];
  const loadPosts = source(posts, true);
  const loadActivity = source([], false);
  const first = await loadFeedPage({ loadPosts, loadActivity, limit: 1 });
  posts.shift();
  posts.unshift(post("just-arrived", date(40)));
  const second = await loadFeedPage({ loadPosts, loadActivity, cursor: first.cursor });
  assert.deepEqual(second.posts.map((row) => row.id), ["middle", "old"]);
});

test("failed pages can be retried without advancing either cursor", async () => {
  const loadPosts = source([post("a", date(30)), post("b", date(20))], true);
  const loadActivity = source([event("1", date(10))], false);
  const first = await loadFeedPage({ loadPosts, loadActivity, limit: 1 });
  const cursorBefore = structuredClone(first.cursor);
  await assert.rejects(loadFeedPage({ loadPosts, loadActivity: async () => { throw new Error("Offline"); }, cursor: first.cursor }));
  assert.deepEqual(first.cursor, cursorBefore);
  const retry = await loadFeedPage({ loadPosts, loadActivity, cursor: first.cursor });
  assert.deepEqual(retry.posts.map((row) => row.id), ["b"]);
  assert.equal(retry.activity.length, 1);
});

test("empty and single-source walls terminate, and older issue pages retain newest state", async () => {
  const empty = await loadFeedPage({ loadPosts: source([], true), loadActivity: source([], false) });
  assert.equal(empty.hasMore, false);
  const latest = event("1", date(20));
  const old = { ...latest, source_id: "1-old", occurred_at: date(10) };
  const activity = [latest, old];
  const first = await loadFeedPage({ loadPosts: source([], true), loadActivity: source(activity, false), limit: 1 });
  const next = await loadFeedPage({ loadPosts: source([], true), loadActivity: source(activity, false), cursor: first.cursor, limit: 1 });
  const filtered = filterWallEntries(wallEntries([], mergeActivity([...first.activity, ...next.activity])), "issues");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].source_id, "1");
  assert.equal(next.hasMore, false);
  assert.equal(appendPosts([post("a", date(10))], [post("a", date(10))]).length, 1);
});

test("database queries bound reads and use both cursor columns without changing visibility", async () => {
  for (const table of ["posts", "repository_activity"]) {
    const calls = [];
    const query = {
      select(value) { calls.push(["select", value]); return this; },
      order(...args) { calls.push(["order", ...args]); return this; },
      limit(value) { calls.push(["limit", value]); return this; },
      in(...args) { calls.push(["in", ...args]); return this; },
      neq(...args) { calls.push(["neq", ...args]); return this; },
      or(value) { calls.push(["or", value]); return this; },
      then(resolve) { return Promise.resolve({ data: [] }).then(resolve); },
    };
    const client = { from(value) { assert.equal(value, table); return query; } };
    const cursor = table === "posts" ? post("a", date(10)) : event("issue:1:2026-09-06T00:00:00.000Z", date(10));
    await feedSource(client, table)(cursor, 21);
    assert.deepEqual(calls.filter(([method]) => method === "limit"), [["limit", 21]]);
    assert.equal(calls.filter(([method]) => method === "order").length, 2);
    assert.equal(calls.filter(([method]) => method === "in").length, table === "repository_activity" ? 1 : 0);
    assert.equal(calls.filter(([method]) => method === "neq").length, table === "repository_activity" ? 1 : 0);
    const filter = calls.find(([method]) => method === "or")[1];
    assert.match(filter, /\.lt\..*,and\(.*\.eq\..*,.*\.gt\./);
    assert.ok(filter.includes(JSON.stringify(table === "posts" ? cursor.id : cursor.source_id)));
  }
});

test("relative durations advance and exact local time includes date, seconds and zone", () => {
  const value = date(0);
  const start = Date.parse(value);
  assert.equal(timeAgo(value, start), "just now");
  assert.equal(timeAgo(value, start + 11 * 60_000), "11m ago");
  assert.equal(timeAgo(value, start + 12 * 60_000), "12m ago");
  assert.equal(timeAgo(value, start + 86_400_000), "1d ago");
  assert.equal(timeAgo(value, start - 1000), "just now");
  const expected = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(value));
  assert.equal(exactTime(value), expected);
});
