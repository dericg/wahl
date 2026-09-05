import { createClient } from "npm:@supabase/supabase-js@2";
import { validateAutomationUpdate } from "../_shared/wahl-fix-status.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

  const callbackToken = Deno.env.get("WAHL_STATUS_CALLBACK_TOKEN");
  const authorization = request.headers.get("Authorization") || "";
  const receivedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!callbackToken || !receivedToken || !(await tokensMatch(receivedToken, callbackToken))) {
    return json({ error: "Authentication required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Automation is not configured" }, 503);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "A JSON body is required" }, 400);
  }
  const policyError = validateAutomationUpdate(payload || {});
  if (policyError) return json({ error: policyError.error }, policyError.status);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const update = {
    status: payload.status,
    pull_request_url: payload.status === "pr_ready" ? payload.pullRequestUrl : null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from("automation_requests").update(update)
    .eq("id", payload.requestId)
    .in("status", ["queued", "working"])
    .select("id,post_id,status,pull_request_url,updated_at")
    .maybeSingle();
  if (error) return json({ error: "The automation status could not be updated" }, 500);
  if (data) return json({ request: data });

  const { data: existing } = await admin.from("automation_requests")
    .select("id,post_id,status,pull_request_url,updated_at")
    .eq("id", payload.requestId)
    .maybeSingle();
  if (!existing) return json({ error: "Automation request not found" }, 404);
  if (existing.status === payload.status && (payload.status !== "pr_ready" || existing.pull_request_url === payload.pullRequestUrl)) {
    return json({ request: existing });
  }
  return json({ error: "The automation request is already complete" }, 409);
});
