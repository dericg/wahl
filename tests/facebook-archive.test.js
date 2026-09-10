import test from "node:test";
import assert from "node:assert/strict";
import { filterArchive, isSupportedArchiveJson, memoriesOnThisDay, readFacebookArchive, repairFacebookText } from "../src/facebookArchive.js";

function fakeFile(path, value = "") {
  return { name: path.split("/").at(-1), webkitRelativePath: path, text: async () => typeof value === "string" ? value : JSON.stringify(value) };
}

test("recognizes only the supported Facebook archive records", () => {
  assert.equal(isSupportedArchiveJson("export/your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json"), true);
  assert.equal(isSupportedArchiveJson("export/your_facebook_activity/stories/archived_stories.json"), true);
  assert.equal(isSupportedArchiveJson("export/your_facebook_activity/messages/inbox/message_1.json"), false);
});

test("normalizes post records and attaches local media without uploading it", async () => {
  const mediaPath = "your_facebook_activity/posts/media/photo.jpg";
  const files = [
    fakeFile("export/your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json", [{
      timestamp: 1_600_000_000, title: "Deric added a photo", data: [{ post: "A saved thought" }],
      attachments: [{ data: [{ media: { uri: mediaPath } }, { external_context: { name: "An article", source: "Example", url: "https://example.com/read" } }] }],
    }]),
    fakeFile(`export/${mediaPath}`),
  ];
  const entries = await readFacebookArchive(files);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, "A saved thought");
  assert.equal(entries[0].kind, "photo");
  assert.equal(entries[0].media[0].file, files[1]);
  assert.deepEqual(entries[0].link, { name: "An article", source: "Example", url: "https://example.com/read" });
});

test("removes duplicate export records with the same time and content", async () => {
  const record = { timestamp: 1_600_000_000, title: "Deric shared a link.", data: [] };
  const entries = await readFacebookArchive([
    fakeFile("export/your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json", [record, record]),
  ]);
  assert.equal(entries.length, 1);
});

test("filters memories and finds prior years on the same day", () => {
  const entries = [
    { id: "a", year: 2020, kind: "post", text: "Blue sky", title: "", occurredAt: "2020-09-06T12:00:00.000Z" },
    { id: "b", year: 2021, kind: "photo", text: "Dinner", title: "", occurredAt: "2021-01-01T12:00:00.000Z" },
  ];
  assert.deepEqual(filterArchive(entries, { query: "sky", year: "2020", kind: "post" }).map((entry) => entry.id), ["a"]);
  assert.deepEqual(memoriesOnThisDay(entries, new Date("2026-09-06T18:00:00.000Z")).map((entry) => entry.id), ["a"]);
});

test("hides Facebook bookkeeping by default and repairs mojibake", () => {
  const entries = [
    { id: "empty", year: 2025, kind: "post", text: "Deric Garza shared a link.", title: "", useful: false },
    { id: "written", year: 2025, kind: "post", text: "Something I wrote", title: "", useful: true },
  ];
  assert.deepEqual(filterArchive(entries).map((entry) => entry.id), ["written"]);
  assert.deepEqual(filterArchive(entries, { scope: "all" }).map((entry) => entry.id), ["empty", "written"]);
  assert.equal(repairFacebookText("It\u00e2\u0080\u0099s here"), "It’s here");
});
