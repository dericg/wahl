import { createClient } from "npm:@supabase/supabase-js@2";

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
  const expected = Deno.env.get("WAHL_SERVER_HEARTBEAT_TOKEN") || "";
  const authorization = request.headers.get("Authorization") || "";
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !received || !(await tokensMatch(received, expected))) return json({ error: "Authentication required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server status is not configured" }, 503);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await admin.from("server_heartbeats").upsert({ server_name: "ubuntu", last_seen_at: new Date().toISOString() });
  if (error) {
    console.error("Server heartbeat failed", error);
    return json({ error: "Heartbeat could not be recorded", code: error.code || "unknown" }, 500);
  }
  return json({ ok: true });
});
