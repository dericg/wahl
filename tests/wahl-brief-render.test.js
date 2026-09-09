import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "vite";
import react from "@vitejs/plugin-react";

// Finite rendering only: no browser, server, effects, or live backend.
test("brief controls label editable text, expose cancellation and gate implementation confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wahl-brief-render-"));
  try {
    const result = await build({
      configFile: false, envFile: false, logLevel: "silent", plugins: [react()],
      define: {
        "import.meta.env.VITE_SUPABASE_URL": '""',
        "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": '""',
      },
      build: {
        ssr: fileURLToPath(new URL("../src/WahlBot.jsx", import.meta.url)), write: false,
        rollupOptions: { output: { paths: (id) => import.meta.resolve(id) } },
      },
    });
    const entry = result.output.find((item) => item.type === "chunk" && item.isEntry);
    const path = join(directory, "bot.mjs");
    await writeFile(path, entry.code);
    const { BriefEditor } = await import(pathToFileURL(path));
    const render = (mode, text, locked = false) => renderToStaticMarkup(createElement(BriefEditor, {
      review: { status: "review", brief: { mode, text } }, locked,
    }));
    for (const mode of ["research", "planning", "implementation"]) {
      const html = render(mode, "Keep <script> as text & preserve scope.");
      assert.match(html, /<label for="wahl-bot-brief">Edit the brief<\/label>/);
      assert.match(html, /<textarea[^>]+id="wahl-bot-brief"[^>]+aria-describedby="wahl-brief-help"/);
      assert.match(html, /<button type="button">Cancel<\/button>/);
      assert.doesNotMatch(html, /<script>/);
      if (mode === "implementation") {
        assert.match(html, /<pre class="bot-brief-text">#fix Keep &lt;script&gt; as text &amp; preserve scope\.<\/pre>/);
        assert.match(html, /<button type="button">Confirm and start code work<\/button>/);
      } else {
        assert.match(html, /This stays in our conversation/);
        assert.doesNotMatch(html, /Confirm and start code work|#fix /);
      }
    }
    for (const [text, locked] of [["", false], ["x".repeat(316), false], ["Valid brief", true]]) {
      assert.match(render("implementation", text, locked), /<button type="button" disabled="">Confirm and start code work<\/button>/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
