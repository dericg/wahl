import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const handler = readFileSync(new URL("../supabase/functions/wahl-chat/index.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
const deployment = readFileSync(new URL("../.github/workflows/deploy-test.yml", import.meta.url), "utf8");

test("conversation storage is owner-readable and server-written", () => {
  assert.match(schema, /Owner can read Wahl conversations/);
  assert.match(schema, /Owner can read Wahl messages/);
  assert.match(schema, /revoke all on public\.wahl_messages from anon, authenticated/);
  assert.doesNotMatch(schema, /grant insert on public\.wahl_messages to authenticated/);
  assert.match(handler, /owner !== true/);
});

test("chat credentials and GitHub access stay server-side and read-only", () => {
  assert.match(handler, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.match(handler, /api\.openai\.com\/v1\/responses/);
  assert.match(handler, /api\.github\.com\/repos\/dericg\/wahl\/contents/);
  assert.doesNotMatch(handler, /method:\s*"(PUT|PATCH|DELETE)"/);
});

test("trusted deployment installs and verifies the chat function", () => {
  assert.match(deployment, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.match(deployment, /supabase secrets set OPENAI_API_KEY=/);
  assert.match(deployment, /supabase functions deploy wahl-chat/);
  assert.match(deployment, /request OPTIONS/);
  assert.match(deployment, /test "\$chat_status" = "200"/);
});
