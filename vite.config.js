import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

function offlineServiceWorker() {
  return {
    name: "wahl-offline-service-worker",
    generateBundle(_, bundle) {
      const base = process.env.WAHL_BASE_PATH || "/";
      const prefix = base.endsWith("/") ? base : `${base}/`;
      const hashedAssets = Object.keys(bundle)
        .filter((file) => /^assets\/.+\.(?:js|css)$/.test(file))
        .map((file) => `${prefix}${file}`);
      const shell = `${prefix}index.html`;
      const offline = `${prefix}offline.html`;
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `const CACHE = "wahl-shell-${version}";
const SHELL = ${JSON.stringify([shell, offline, ...hashedAssets])};
const OFFLINE = ${JSON.stringify(offline)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("wahl-shell-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const isNavigation = request.mode === "navigate";
  const isAsset = /(?:^|\\/)assets\\/[^/]+\\.(?:js|css)$/.test(url.pathname);
  if (!isNavigation && !isAsset) return;
  if (isNavigation) {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE).then((response) => response || new Response("Wahl is offline.", { status: 503 }))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
`,
      });
    },
  };
}

function getCommitHistory() {
  try {
    return execFileSync("git", ["log", "-5", "--format=%h%x09%cI%x09%s"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim().split("\n").filter(Boolean).map((line) => {
      const [hash, date, ...message] = line.split("\t");
      return { hash, date, message: message.join(" ") };
    });
  } catch {
    return [];
  }
}

export default defineConfig({
  base: process.env.WAHL_BASE_PATH || "/",
  plugins: [react(), offlineServiceWorker()],
  define: {
    __WAHL_RELEASE__: JSON.stringify({ version, commits: getCommitHistory() }),
  },
});
