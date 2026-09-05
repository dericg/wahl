import { createClient } from "npm:@supabase/supabase-js@2";
import { validateFixRequest } from "../_shared/wahl-fix-policy.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Authentication required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const githubToken = Deno.env.get("WAHL_GITHUB_TOKEN");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !githubToken) return json({ error: "Automation is not configured" }, 503);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Authentication required" }, 401);

  const { data: owner, error: ownerError } = await userClient.rpc("is_wahl_owner");
  if (ownerError) return json({ error: "Owner verification failed" }, 500);

  const { postId } = await request.json();
  if (typeof postId !== "string") return json({ error: "A post ID is required" }, 400);

  const { data: post, error: postError } = await userClient.from("posts").select("id,author_id,text,audience_type").eq("id", postId).maybeSingle();
  if (postError) return json({ error: "The fix request could not be read" }, 500);
  const policyError = validateFixRequest({ owner: Boolean(owner), userId: user.id, post });
  if (policyError) return json({ error: policyError.error }, policyError.status);
  if (!post) return json({ error: "This post is not an eligible private fix request" }, 400);

  const { data: existing } = await userClient.from("automation_requests").select("id,post_id,status,pull_request_url,updated_at").eq("post_id", post.id).maybeSingle();
  if (existing) {
    const branch = `codex/wahl-fix-${existing.id}`;
    const pulls = await fetch(`https://api.github.com/repos/dericg/wahl/pulls?state=all&head=dericg:${encodeURIComponent(branch)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Wahl-Automation",
      },
    });
    if (pulls.ok) {
      const [pullRequest] = await pulls.json();
      if (pullRequest) {
        const status = pullRequest.state === "open" ? "pr_ready" : "closed";
        const { data: refreshed } = await admin.from("automation_requests").update({
          status,
          pull_request_url: pullRequest.html_url,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id).select("id,post_id,status,pull_request_url,updated_at").single();
        return json({ request: refreshed || existing });
      }
    }
    const age = Date.now() - new Date(existing.updated_at).getTime();
    if (existing.status === "queued" && age > 30_000) {
      const { data: working } = await admin.from("automation_requests").update({ status: "working", updated_at: new Date().toISOString() }).eq("id", existing.id).select("id,post_id,status,pull_request_url,updated_at").single();
      return json({ request: working || existing });
    }
    return json({ request: existing });
  }

  const { data: automation, error: insertError } = await userClient.from("automation_requests").insert({
    post_id: post.id,
    requested_by: user.id,
    status: "queued",
  }).select("id,post_id,status,pull_request_url,updated_at").single();
  if (insertError) return json({ error: `The automation request could not be created (${insertError.code || "database error"})` }, 500);

  const dispatch = await fetch("https://api.github.com/repos/dericg/wahl/actions/workflows/wahl-fix.yml/dispatches", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Wahl-Automation",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { request_id: automation.id, post_id: post.id, thought: post.text },
    }),
  });

  if (!dispatch.ok) {
    await admin.from("automation_requests").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", automation.id);
    return json({ error: "GitHub did not accept the automation request" }, 502);
  }

  return json({ request: automation }, 202);
});
