import { parseLinkMetadata, safePreviewUrl } from "./link-preview-policy.js";

async function boundedHtml(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < 524288) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value.subarray(0, Math.max(0, value.length - Math.max(0, size - 524288))));
  }
  reader.cancel().catch(() => {});
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export async function loadLinkPreview(admin, inputUrl) {
  const url = safePreviewUrl(inputUrl);
  if (!url) return { error: "This link cannot be previewed", status: 400 };
  const { data: cached } = await admin.from("link_previews").select("url,title,description,site_name,image_url,fetched_at,status").eq("url", url).maybeSingle();
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 30 * 86400000) return { preview: cached };
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
      if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) throw new Error("Preview unavailable");
      const metadata = parseLinkMetadata(await boundedHtml(response), current);
      const preview = { url, title: metadata.title || null, description: metadata.description || null, site_name: metadata.siteName || null, image_url: metadata.imageUrl, status: "ready", fetched_at: new Date().toISOString() };
      await admin.from("link_previews").upsert(preview, { onConflict: "url" });
      return { preview };
    }
    throw new Error("Too many redirects");
  } catch {
    const preview = { url, title: null, description: null, site_name: null, image_url: null, status: "unavailable", fetched_at: new Date().toISOString() };
    await admin.from("link_previews").upsert(preview, { onConflict: "url" });
    return { preview };
  }
}
