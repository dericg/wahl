import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "vite";
import react from "@vitejs/plugin-react";

// Finite rendering only: no browser, Supabase connection, or React effects.
test("only a configured, signed-in owner sees passkey enrollment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wahl-sign-in-"));
  try {
    const result = await build({
      configFile: false, envFile: false, logLevel: "silent", plugins: [react()],
      build: {
        ssr: fileURLToPath(new URL("../src/SignIn.jsx", import.meta.url)), write: false,
        rollupOptions: { output: { paths: (id) => import.meta.resolve(id) } },
      },
    });
    const path = join(directory, "sign-in.mjs");
    await writeFile(path, result.output.find((item) => item.type === "chunk" && item.isEntry).code);
    const { default: SignIn } = await import(pathToFileURL(path));
    const render = (props) => renderToStaticMarkup(createElement(SignIn, props));
    const client = { auth: {} };
    const session = { user: { id: "owner" } };
    const owner = render({ client, session, owner: true });
    assert.match(owner, /Add passkey/);
    assert.match(owner, /Set password/);
    assert.match(owner, /Sign out/);
    assert.match(owner, /role="status"/);
    assert.match(owner, /<button disabled=""[^>]*>Add passkey/);
    assert.match(owner, /Passkeys need a supported browser and a secure connection/);
    const visitor = render({ client, session, owner: false });
    assert.match(visitor, /Not authorized/);
    assert.doesNotMatch(visitor, /Add passkey|Set password/);
    const publicView = render({ client, owner: false });
    assert.match(publicView, /Owner sign in/);
    assert.doesNotMatch(publicView, /Add passkey|<input/);
    assert.equal(render({ previewMode: true, owner: true }), "<span>Local preview</span>");
    assert.equal(render({ previewMode: false, owner: false }), "<span>Read-only</span>");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
