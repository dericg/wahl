export const SERVER_ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function serverStatus(lastSeenAt, now = Date.now()) {
  const lastSeen = Date.parse(lastSeenAt || "");
  if (!Number.isFinite(lastSeen)) return { state: "unknown", label: "status unavailable" };
  const online = now - lastSeen <= SERVER_ONLINE_WINDOW_MS;
  return { state: online ? "online" : "offline", label: online ? "online" : "offline" };
}
