import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVER_ONLINE_WINDOW_MS, serverStatus } from "../src/serverStatus.js";

test("a fresh heartbeat is online and a stale heartbeat is offline", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  assert.equal(serverStatus(new Date(now - SERVER_ONLINE_WINDOW_MS).toISOString(), now).state, "online");
  assert.equal(serverStatus(new Date(now - SERVER_ONLINE_WINDOW_MS - 1).toISOString(), now).state, "offline");
  assert.equal(serverStatus(null, now).state, "unknown");
});

test("heartbeat writes are authenticated and server status stays owner-only", () => {
  const edgeFunction = readFileSync(new URL("../supabase/functions/server-heartbeat/index.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260910120000_server_heartbeat.sql", import.meta.url), "utf8");
  const deployment = readFileSync(new URL("../.github/workflows/deploy-test.yml", import.meta.url), "utf8");
  assert.match(edgeFunction, /WAHL_SERVER_HEARTBEAT_TOKEN/);
  assert.match(edgeFunction, /crypto\.subtle\.digest/);
  assert.doesNotMatch(edgeFunction, /Access-Control-Allow-Origin/);
  assert.match(migration, /revoke all on public\.server_heartbeats from anon, authenticated/);
  assert.match(migration, /using \(public\.is_wahl_owner\(\)\)/);
  assert.match(deployment, /supabase functions deploy server-heartbeat/);
  assert.match(deployment, /test "\$heartbeat_status" = "401"/);
});
