const blockedNames = new Set(["localhost", "localhost.localdomain"]);

export function safePreviewUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || blockedNames.has(host) || host.endsWith('.local')) return null;
  if (/^(?:0|10|127|169\.254|192\.168)\./.test(host)) return null;
  const private172 = /^172\.(\d+)\./.exec(host);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return null;
  if (/^(?:224|225|226|227|228|229|23\d|24\d|25\d)\./.test(host)) return null;
  if (host === '::1' || host === '::' || /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(host)) return null;
  url.hash = '';
  return url.toString();
}

function entity(value = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] || _;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : _;
  });
}

function content(attributes) {
  return /\bcontent\s*=\s*(["'])(.*?)\1/is.exec(attributes)?.[2] || '';
}

export function parseLinkMetadata(html, pageUrl) {
  const meta = new Map();
  for (const match of html.matchAll(/<meta\b([^>]+)>/gis)) {
    const attributes = match[1];
    const key = /\b(?:property|name)\s*=\s*(["'])(.*?)\1/is.exec(attributes)?.[2]?.toLowerCase();
    if (key && !meta.has(key)) meta.set(key, entity(content(attributes)).trim());
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '';
  const rawImage = meta.get('og:image') || meta.get('twitter:image') || '';
  let imageUrl = null;
  try { imageUrl = rawImage ? safePreviewUrl(new URL(rawImage, pageUrl).toString()) : null; } catch { imageUrl = null; }
  const bounded = (value, length) => Array.from(String(value || '').replace(/\s+/g, ' ').trim()).slice(0, length).join('');
  return {
    title: bounded(meta.get('og:title') || meta.get('twitter:title') || entity(titleTag.replace(/<[^>]+>/g, ' ')), 240),
    description: bounded(meta.get('og:description') || meta.get('description') || meta.get('twitter:description'), 400),
    siteName: bounded(meta.get('og:site_name'), 120),
    imageUrl,
  };
}
