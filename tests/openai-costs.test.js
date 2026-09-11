import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatOpenAICost } from "../src/openaiCosts.js";
import { currentUtcMonth, summarizeCosts } from "../supabase/functions/_shared/openai-costs.js";

test("cost summaries total OpenAI buckets and format currency", () => {
  assert.deepEqual(summarizeCosts({ data: [
    { results: [{ amount: { value: 1.235, currency: "usd" } }] },
    { results: [{ amount: { value: 2.4, currency: "usd" } }] },
  ] }), { amount: 3.635, currency: "usd" });
  assert.equal(formatOpenAICost(3.635, "usd"), "$3.64");
  assert.equal(formatOpenAICost(null), "unavailable");
});

test("the reporting window is the current UTC month", () => {
  assert.deepEqual(currentUtcMonth(new Date("2026-09-10T12:30:00Z")), {
    startTime: 1788220800,
    period: "2026-09",
  });
});

test("cost reporting stays server-side and owner-only", () => {
  const handler = readFileSync(new URL("../supabase/functions/openai-costs/index.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const deployment = readFileSync(new URL("../.github/workflows/deploy-test.yml", import.meta.url), "utf8");
  assert.match(handler, /userClient\.auth\.getUser\(\)/);
  assert.match(handler, /owner !== true/);
  assert.match(handler, /Deno\.env\.get\("OPENAI_ADMIN_KEY"\)/);
  assert.match(handler, /Deno\.env\.get\("OPENAI_PROJECT_ID"\)/);
  assert.match(handler, /project_ids\[\]/);
  assert.doesNotMatch(handler, /searchParams\.set\("end_time"/);
  assert.match(handler, /Cache-Control": "no-store"/);
  assert.doesNotMatch(app, /OPENAI_ADMIN_KEY|OPENAI_PROJECT_ID/);
  assert.match(deployment, /supabase functions deploy openai-costs/);
});
