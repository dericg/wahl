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
      const { default: App, ActivityGroup, ActivityCard } = await import(pathToFileURL(path));
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
      assert.equal(html.includes('aria-label="Ubuntu server status"'), owner);
      assert.equal(html.includes('aria-label="OpenAI cost status"'), owner);
      assert.match(html, /role="group" aria-label="Filter the wall"/);
      if (grouped) {
        assert.match(html, /aria-label="2 updates about work on this site"/);
        const workSummary = html.match(/<div class="activity-work-summary">([\s\S]*?)<\/div>/)?.[1];
        assert.ok(workSummary);
        assert.match(workSummary, /<p>What Deric is changing<\/p>/);
        assert.match(workSummary, /<ul aria-label="Work summary">/);
        assert.match(workSummary, /Deric saved work on “A small update”/);
        assert.match(html, /<details class="activity-details"><summary>See all 2 original notes<\/summary>/);
        const details = html.match(/<details class="activity-details">([\s\S]*?)<\/details>/)?.[1];
        assert.match(details, /These links open Deric’s detailed project notes on GitHub/);
        assert.match(details, /<a[^>]+>Deric saved work on/);
        assert.doesNotMatch(html, /<details[^>]*\bopen\b|<script>/);
        for (const hash of ["abcdef1", "abcdef2"]) {
          for (const section of [workSummary, details]) {
            assert.ok(section.includes(`href="https://github.com/dericg/wahl/commit/${hash}" target="_blank" rel="noreferrer"`));
          }
        }
        assert.match(html, new RegExp(`${owner ? 7 : 2} entries loaded`));
        const activities = [
          { source_id: "deployment:10:3", kind: "Deployment", summary: "github-pages · success", url: "https://github.com/dericg/wahl/deployments", occurred_at: "2026-09-06T03:00:00Z" },
          { source_id: "pr:44:opened", kind: "Pull request", summary: 'opened #44 · <img src=x onerror="alert(1)"> · merged · success', url: "https://github.com/dericg/wahl/pull/44", occurred_at: "2026-09-06T02:00:00Z" },
          { source_id: "deployment:10:2", kind: "Deployment", summary: "github-pages · in_progress", url: "https://github.com/dericg/wahl/deployments", occurred_at: "2026-09-06T01:00:00Z" },
          { source_id: "deployment:10:1", kind: "Deployment", summary: "github-pages · queued", url: "https://github.com/dericg/wahl/deployments", occurred_at: "2026-09-06T00:00:00Z" },
        ].map((activity) => ({ ...activity, id: `github:${activity.source_id}` }));
        const outcomeHtml = renderToStaticMarkup(createElement(ActivityGroup, { activities, now: Date.now() }));
        const [main, notes] = outcomeHtml.split('<details class="activity-details">');
        assert.match(main, /aria-label="2 updates about work on this site"/);
        assert.match(main, /A new test version of Wahl is ready. It includes the proposed changes and can now be reviewed/);
        assert.match(main, /Deric prepared this change: “&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; · merged · success”/);
        assert.match(main, /reviewing it before making it part of Wahl/);
        assert.doesNotMatch(main, /in_progress|queued|still underway|<img/);
        assert.match(notes, /<summary>See all 2 original notes<\/summary>/);
        assert.match(notes, /A new test version of Wahl is ready[\s\S]*Deric prepared this change/);
        assert.equal((notes.match(/<li>/g) || []).length, 2);
        assert.doesNotMatch(notes, /github-pages|in_progress|queued|opened #44/);
        assert.doesNotMatch(outcomeHtml, /<details[^>]*\bopen\b|<img|<button|tabindex="-1"/);
        for (const section of [main, notes]) {
          assert.match(section, /href="https:\/\/github.com\/dericg\/wahl\/pull\/44" target="_blank" rel="noreferrer"/);
          assert.match(section, /href="https:\/\/github.com\/dericg\/wahl\/deployments" target="_blank" rel="noreferrer"/);
        }

        // The same event explanation is visible in summaries, expanded details,
        // and standalone cards. Links retain their destinations and native focus.
        for (const [state, explanation] of [
          ["success", /A new test version of Wahl is ready\. It includes the proposed changes and can now be reviewed\./],
          ["failure", /Wahl could not publish the proposed update\. The previous version is still available\./],
          ["in_progress", /A new version of Wahl is still being prepared\. Nothing new is ready to review from this attempt yet\./],
        ]) {
          const event = { ...activities[0], summary: `github-pages · ${state}` };
          const group = renderToStaticMarkup(createElement(ActivityGroup, { activities: [event, ...activities.slice(1)], now: Date.now() }));
          const card = renderToStaticMarkup(createElement(ActivityCard, { activity: event, now: Date.now() }));
          const sections = [...group.split('<details class="activity-details">'), card];
          for (const section of sections) {
            assert.match(section, explanation);
            assert.doesNotMatch(section, /site publishing step|linked record|automatic task result|which version and site it was for|github-pages|in_progress|queued/i);
            assert.match(section, /<a href="https:\/\/github.com\/dericg\/wahl\/deployments" target="_blank" rel="noreferrer">(?:A new|Wahl could not)/);
          }
        }
        const unmatched = [
          activities[0],
          { ...activities[2], id: "legacy", source_id: "legacy" },
          { ...activities[3], id: "another-attempt", source_id: "deployment:11:1", summary: "github-pages · failure" },
        ];
        const unmatchedHtml = renderToStaticMarkup(createElement(ActivityGroup, { activities: unmatched, now: Date.now() }));
        const unmatchedDetails = unmatchedHtml.split('<details class="activity-details">')[1];
        assert.equal((unmatchedDetails.match(/<li>/g) || []).length, 3);
        assert.match(unmatchedDetails, /A new test version of Wahl is ready[\s\S]*A new version of Wahl is still being prepared[\s\S]*Wahl could not publish the proposed update/);
        assert.doesNotMatch(unmatchedDetails, /github-pages|in_progress|queued/);
      } else {
        assert.doesNotMatch(html, /activity-details/);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
