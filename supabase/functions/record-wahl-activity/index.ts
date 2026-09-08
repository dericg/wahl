import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeActivity, readerSummaryFromBody, validateActivity } from "../_shared/wahl-activity-policy.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function tokensMatch(received: string, expected: string) {
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(receivedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("WAHL_STATUS_CALLBACK_TOKEN");
  const authorization = request.headers.get("Authorization") || "";
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !received || !(await tokensMatch(received, expected))) return json({ error: "Authentication required" }, 401);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: "A JSON body is required" }, 400); }
  const deployment = payload?.kind === "Deployment" && /^github-pages · success · #(\d+) · /.exec(payload.summary || "");
  const pullUrl = deployment && new RegExp(`^https://github\\.com/dericg/wahl/pull/${deployment[1]}/?$`).test(payload.url || "");
  if (deployment && pullUrl && !String(payload.summary).includes(" · reader:")) {
    try {
      const response = await fetch(`https://api.github.com/repos/dericg/wahl/pulls/${deployment[1]}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Wahl-Activity" } });
      if (response.ok) {
        const pull = await response.json();
        const summary = readerSummaryFromBody(pull?.body);
        const title = String(pull?.title || "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
        if (summary) payload.summary = `github-pages · success · #${deployment[1]} · reader:${summary}`;
        else if (title) payload.summary = `github-pages · success · #${deployment[1]} · ${Array.from(title).slice(0, 220).join("")}`;
      }
    } catch {
      // Retain the bounded workflow summary if GitHub is temporarily unavailable.
    }
  }
  const policyError = validateActivity(payload || {});
  if (policyError) return json({ error: policyError }, 400);
  payload = normalizeActivity(payload);
  if (!payload) return json({ ignored: true });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Activity recording is not configured" }, 503);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.from("repository_activity").upsert({
    source_id: payload.sourceId,
    kind: payload.kind,
    summary: payload.summary.trim(),
    url: payload.url,
    occurred_at: new Date(payload.occurredAt).toISOString(),
  }).select("source_id,kind,summary,url,occurred_at").maybeSingle();
  if (error) {
    console.error("Repository activity insert failed", error);
    return json({ error: "Repository activity could not be recorded", code: error.code || "unknown" }, 500);
  }
  return json({ activity: data });
});
