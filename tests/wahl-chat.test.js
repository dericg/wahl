import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const handler = readFileSync(new URL("../supabase/functions/wahl-chat/index.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
const deployment = readFileSync(new URL("../.github/workflows/deploy-test.yml", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const bot = readFileSync(new URL("../src/WahlBot.jsx", import.meta.url), "utf8");

test("conversation is owner-only and browser clients cannot write messages", () => {
  assert.match(schema, /Owner can read Wahl conversations/);
  assert.match(schema, /Owner can read Wahl messages/);
  assert.match(schema, /revoke all on public\.wahl_messages from anon, authenticated/);
  assert.doesNotMatch(schema, /grant insert on public\.wahl_messages to authenticated/);
  assert.match(handler, /owner !== true/);
  assert.match(handler, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("chat credentials and repository access remain server-side and read-only", () => {
  assert.match(handler, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.match(handler, /api\.openai\.com\/v1\/responses/);
  assert.match(handler, /api\.github\.com\/repos\/dericg\/wahl\/contents/);
  assert.doesNotMatch(handler, /method:\s*"(PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(app + bot, /OPENAI_API_KEY|WAHL_GITHUB_TOKEN/);
});

test("code work requires the owner's separate prepare action", () => {
  assert.match(bot, /Prepare this change/);
  assert.match(bot, /latestUserMessage\.content\.slice\(0, 300\)/);
  assert.match(app, /text: `#fix \$\{instruction\}`/);
  assert.match(app, /audience: "private"/);
  assert.match(app, /dispatch-wahl-fix/);
});

test("trusted test deployment installs the server secret and chat function", () => {
  assert.match(deployment, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.match(deployment, /supabase secrets set OPENAI_API_KEY=/);
  assert.match(deployment, /supabase functions deploy wahl-chat/);
  assert.match(deployment, /request OPTIONS/);
  assert.match(deployment, /test "\$chat_status" = "200"/);
});

test("client handles non-Response function error contexts", () => {
  assert.match(bot, /typeof context\.json === "function"/);
  assert.match(bot, /typeof context\.error === "string"/);
});
