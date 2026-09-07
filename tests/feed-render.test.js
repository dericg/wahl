import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "vite";
import react from "@vitejs/plugin-react";

test("site header remains pinned while the wall scrolls", async () => {
  const css = await readFile(fileURLToPath(new URL("../src/production.css", import.meta.url)), "utf8");
  assert.match(css, /\.site-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(css, /main\s*\{[^}]*overflow:\s*clip;/s);
});

// Finite server rendering checks card semantics and owner/public controls.
// No server, browser, backend connection, timers or React effects are started.
test("owner preview and public cards expose exact and relative semantic time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wahl-feed-render-"));
  try {
    for (const { owner, grouped } of [{ owner: false, grouped: false }, { owner: true, grouped: false }, { owner: false, grouped: true }, { owner: true, grouped: true }]) {
      const result = await build({
        configFile: false, envFile: false, logLevel: "silent", plugins: [react()],
        define: {
          "import.meta.env.DEV": JSON.stringify(owner),
          "import.meta.env.VITE_SUPABASE_URL": '""',
          "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": '""',
          __WAHL_RELEASE__: JSON.stringify({ version: "0.2.0", commits: [
            { hash: "abcdef1", date: "2026-09-06T00:00:00Z", message: "A small update" },
            ...(grouped ? [{ hash: "abcdef2", date: "2026-09-06T00:00:00Z", message: "<script>untrusted title</script>" }] : []),
          ] }),
        },
        build: {
          ssr: fileURLToPath(new URL("../src/App.jsx", import.meta.url)), write: false,
          rollupOptions: { output: { paths: (id) => import.meta.resolve(id) } },
        },
      });
      const entry = result.output.find((item) => item.type === "chunk" && item.isEntry);
      const path = join(directory, `${owner ? "owner" : "public"}-${grouped}.mjs`);
      await writeFile(path, entry.code);
      const { default: App } = await import(pathToFileURL(path));
      const html = renderToStaticMarkup(createElement(App));
      const cards = [...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(([card]) => card);
      assert.equal(cards.length, owner ? 6 : 1);
      for (const card of cards) {
        assert.match(card, /<time class="card-time" dateTime="[^"]+">/);
        assert.match(card, /<span>(?:just now|\d+[smhd] ago)<\/span>/);
        assert.match(card, /<span class="exact-time">[^<]+<\/span>/);
        assert.doesNotMatch(card.match(/<time\b[\s\S]*?<\/time>/)[0], /aria-hidden|title=/);
      }
      assert.equal(html.includes('aria-label="Create a post"'), owner);
      assert.equal(html.includes('aria-label="Delete this post"'), owner);
      assert.equal(html.includes("Only me"), owner);
      assert.match(html, /role="group" aria-label="Filter the wall"/);
      if (grouped) {
        assert.match(html, /aria-label="2 updates from GitHub"/);
        assert.match(html, /<p>2 commits<\/p>/);
        const workSummary = html.match(/<div class="activity-work-summary">([\s\S]*?)<\/div>/)?.[1];
        assert.ok(workSummary);
        assert.match(workSummary, /<p>Work summary<\/p>/);
        assert.match(workSummary, /<ul aria-label="Work summary">/);
        assert.match(workSummary, /<a[^>]+>A small update<\/a>/);
        assert.match(workSummary, /&lt;script&gt;untrusted title&lt;\/script&gt;/);
        assert.match(html, /<details class="activity-details"><summary>View 2 updates<\/summary>/);
        assert.doesNotMatch(html, /<details[^>]*\bopen\b|<script>/);
        assert.match(html, /&lt;script&gt;untrusted title&lt;\/script&gt;/);
        for (const hash of ["abcdef1", "abcdef2"]) {
          assert.ok(html.includes(`href="https://github.com/dericg/wahl/commit/${hash}"`));
        }
        assert.match(html, new RegExp(`${owner ? 7 : 2} entries loaded`));
      } else {
        assert.doesNotMatch(html, /activity-details/);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
