const POST_FILE = /(?:^|\/)your_facebook_activity\/posts\/your_posts__check_ins__photos_and_videos_\d+\.json$/;
const STORY_FILE = /(?:^|\/)your_facebook_activity\/stories\/archived_stories\.json$/;
const MEDIA_FILE = /\.(?:jpe?g|png|gif|webp|mp4|mov)$/i;

function cleanPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^.*?(your_facebook_activity\/)/, "$1");
}

export function repairFacebookText(value) {
  return String(value || "").replace(/[\u0080-\u00ff]{2,}/g, (fragment) => {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(fragment, (character) => character.charCodeAt(0)));
      return decoded;
    } catch {
      return fragment;
    }
  });
}

function textValue(record) {
  const post = (record.data || []).find((item) => typeof item?.post === "string")?.post;
  return repairFacebookText(post || record.title).trim();
}

function mediaUris(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (typeof value.uri === "string" && MEDIA_FILE.test(value.uri)) found.push(cleanPath(value.uri));
  for (const child of Array.isArray(value) ? value : Object.values(value)) mediaUris(child, found);
  return found;
}

function firstNested(value, key) {
  if (!value || typeof value !== "object") return null;
  if (value[key] && typeof value[key] === "object") return value[key];
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const match = firstNested(child, key);
    if (match) return match;
  }
  return null;
}

function linkContext(record) {
  const context = firstNested(record.attachments, "external_context");
  const url = /^https?:\/\//i.test(context?.url || "") ? context.url : "";
  if (!url) return null;
  return { url, name: repairFacebookText(context.name).trim(), source: repairFacebookText(context.source).trim() };
}

function placeContext(record) {
  const place = firstNested(record.attachments, "place");
  return repairFacebookText(place?.name).trim();
}

function hasUsefulContent(entry) {
  if (entry.media.length || entry.link || entry.place) return true;
  return !/^(?:Deric Garza )?(?:shared a link|updated his status|added (?:a|\d+ new) photos?|posted a video|was live)\.?$/i.test(entry.text);
}

function archiveKind(record, sourcePath, media) {
  if (STORY_FILE.test(sourcePath)) return "story";
  if (media.some((item) => /\.(?:mp4|mov)$/i.test(item.path))) return "video";
  if (media.length) return "photo";
  if (/checked in|was at| is at /i.test(record.title || "")) return "check-in";
  return "post";
}

function recordsFromJson(value, sourcePath) {
  if (Array.isArray(value)) return value;
  if (STORY_FILE.test(sourcePath) && Array.isArray(value?.archived_stories_v2)) return value.archived_stories_v2;
  return [];
}

export function isSupportedArchiveJson(path) {
  const clean = cleanPath(path);
  return POST_FILE.test(clean) || STORY_FILE.test(clean);
}

export async function readFacebookArchive(files, onProgress = () => {}) {
  const allFiles = Array.from(files || []);
  const byPath = new Map(allFiles.map((file) => [cleanPath(file.webkitRelativePath || file.name), file]));
  const jsonFiles = allFiles.filter((file) => isSupportedArchiveJson(file.webkitRelativePath || file.name));
  const entries = [];

  for (let fileIndex = 0; fileIndex < jsonFiles.length; fileIndex += 1) {
    const file = jsonFiles[fileIndex];
    const sourcePath = cleanPath(file.webkitRelativePath || file.name);
    const parsed = JSON.parse(await file.text());
    for (const [recordIndex, record] of recordsFromJson(parsed, sourcePath).entries()) {
      if (!Number.isFinite(record?.timestamp) || record.timestamp <= 0) continue;
      const media = [...new Set(mediaUris(record))].flatMap((path) => {
        const mediaFile = byPath.get(path) || [...byPath.entries()].find(([candidate]) => candidate.endsWith(path))?.[1];
        return mediaFile ? [{ path, file: mediaFile }] : [];
      });
      const text = textValue(record);
      if (!text && !media.length) continue;
      const occurredAt = new Date(record.timestamp * 1000).toISOString();
      const link = linkContext(record);
      entries.push({
        id: `facebook:${sourcePath}:${recordIndex}:${record.timestamp}`,
        sourcePath,
        occurredAt,
        year: new Date(occurredAt).getFullYear(),
        text,
        title: repairFacebookText(record.title).trim(),
        media,
        link,
        place: placeContext(record),
        kind: archiveKind(record, sourcePath, media),
      });
    }
    onProgress({ current: fileIndex + 1, total: jsonFiles.length });
  }

  const unique = new Map();
  for (const entry of entries) {
    const identity = [entry.occurredAt, entry.text, entry.link?.url, entry.media.map((item) => item.path).join("\u0000")].join("\u0001");
    if (!unique.has(identity)) unique.set(identity, entry);
  }
  return [...unique.values()].map((entry) => ({ ...entry, useful: hasUsefulContent(entry) }))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
}

export function filterArchive(entries, { query = "", year = "all", kind = "all", scope = "useful" } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => (scope === "all" || entry.useful !== false)
    && (year === "all" || entry.year === Number(year))
    && (kind === "all" || entry.kind === kind)
    && (!needle || `${entry.text} ${entry.title} ${entry.link?.name || ""} ${entry.link?.source || ""} ${entry.place || ""}`.toLocaleLowerCase().includes(needle)));
}

export function memoriesOnThisDay(entries, date = new Date()) {
  const month = date.getMonth();
  const day = date.getDate();
  const year = date.getFullYear();
  return entries.filter((entry) => {
    const occurred = new Date(entry.occurredAt);
    return occurred.getFullYear() < year && occurred.getMonth() === month && occurred.getDate() === day;
  });
}
