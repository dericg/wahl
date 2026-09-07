import { createClient } from "npm:@supabase/supabase-js@2";
import { parseLinkMetadata, safePreviewUrl } from "../_shared/link-preview-policy.js";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" } });

async function boundedHtml(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 524288) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value.subarray(0, Math.max(0, value.length - Math.max(0, size - 524288))));
  }
  reader.cancel().catch(() => {});
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization) return json({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Preview service is unavailable" }, 503);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceKey);
  const [{ data: { user } }, { data: owner, error: ownerError }] = await Promise.all([userClient.auth.getUser(), userClient.rpc("is_wahl_owner")]);
  if (!user || ownerError || owner !== true) return json({ error: "Owner access required" }, 403);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const url = safePreviewUrl(input?.url);
  if (!url) return json({ error: "This link cannot be previewed" }, 400);
  const { data: cached } = await admin.from("link_previews").select("url,title,description,site_name,image_url,fetched_at,status").eq("url", url).maybeSingle();
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 30 * 86400000) return json({ preview: cached });

  let current = url;
  try {
    for (let redirects = 0; redirects < 4; redirects += 1) {
      const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(7000), headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Wahl-Link-Preview/1.0" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        current = location ? safePreviewUrl(new URL(location, current).toString()) || "" : "";
        if (!current) throw new Error("Unsafe redirect");
        continue;
      }
      const type = response.headers.get("content-type") || "";
      if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("Preview unavailable");
      const metadata = parseLinkMetadata(await boundedHtml(response), current);
      const preview = { url, title: metadata.title || null, description: metadata.description || null, site_name: metadata.siteName || null, image_url: metadata.imageUrl, status: "ready", fetched_at: new Date().toISOString() };
      await admin.from("link_previews").upsert(preview, { onConflict: "url" });
      return json({ preview });
    }
    throw new Error("Too many redirects");
  } catch {
    const preview = { url, title: null, description: null, site_name: null, image_url: null, status: "unavailable", fetched_at: new Date().toISOString() };
    await admin.from("link_previews").upsert(preview, { onConflict: "url" });
    return json({ preview });
  }
});
