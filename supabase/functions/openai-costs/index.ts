import { createClient } from "npm:@supabase/supabase-js@2";
import { currentUtcMonth, summarizeCosts } from "../_shared/openai-costs.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store", "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Authentication required" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "Cost reporting is not configured" }, 503);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Authentication required" }, 401);
  const { data: owner, error: ownerError } = await userClient.rpc("is_wahl_owner");
  if (ownerError) return json({ error: "Owner verification failed" }, 500);
  if (owner !== true) return json({ error: "Owner access required" }, 403);

  const adminKey = Deno.env.get("OPENAI_ADMIN_KEY");
  const projectId = Deno.env.get("OPENAI_PROJECT_ID");
  if (!adminKey || !projectId) return json({ error: "Cost reporting is not configured" }, 503);
  if (!/^proj_[A-Za-z0-9_-]{6,}$/.test(projectId)) return json({ error: "Cost reporting project is invalid" }, 503);

  const range = currentUtcMonth();
  const url = new URL("https://api.openai.com/v1/organization/costs");
  url.searchParams.set("start_time", String(range.startTime));
  url.searchParams.set("end_time", String(range.endTime));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", "31");
  url.searchParams.append("project_ids[]", projectId);

  const response = await fetch(url, { headers: { Authorization: `Bearer ${adminKey}` } });
  if (!response.ok) {
    if (response.status === 429) return json({ error: "OpenAI cost reporting is temporarily limited" }, 503);
    if (response.status === 401 || response.status === 403) return json({ error: "OpenAI cost reporting credentials need attention" }, 503);
    return json({ error: "OpenAI costs are temporarily unavailable" }, 502);
  }

  try {
    const summary = summarizeCosts(await response.json());
    return json({ ...summary, period: range.period });
  } catch {
    return json({ error: "OpenAI returned an invalid costs response" }, 502);
  }
});
