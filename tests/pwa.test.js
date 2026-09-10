import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PWA shell is installable without exposing personal data to the service worker", async () => {
  const [manifest, worker, html, offline] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../dist/sw.js", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/offline.html", import.meta.url), "utf8"),
  ]);
  const app = JSON.parse(manifest);
  assert.equal(app.name, "Wahl");
  assert.equal(app.display, "standalone");
  assert.equal(app.theme_color, "#130c08");
  assert.match(html, /manifest\.webmanifest/);
  assert.match(offline, /Private thoughts and conversations are never stored/);
  if (worker) {
    assert.match(worker, /wahl-shell-/);
    assert.doesNotMatch(worker, /supabase|wahl-chat|repository_activity|wahl_messages/);
  }
});
