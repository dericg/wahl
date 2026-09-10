const kinds = new Set(["Commit", "Issue", "Pull request", "Deployment", "Workflow"]);
const sourceId = /^[A-Za-z0-9:._-]{1,160}$/;
const repositoryUrl = /^https:\/\/github\.com\/dericg\/wahl(?:\/|$)/;

export function publicWorkflow(summary) {
  return /^(Validate Wahl|Turn a Wahl thought into a pull request) · (success|failure|cancelled|timed_out|action_required|startup_failure)$/.test(summary);
}

export function readerSummaryFromBody(body) {
  if (typeof body !== "string") return "";
  const lines = body.split(/\r?\n/);
  const parts = [];
  let inside = false;
  for (const line of lines) {
    if (/^##\s+Reader summary\s*$/i.test(line.trim())) { inside = true; continue; }
    if (inside && /^##\s+/.test(line.trim())) break;
    if (inside && line.trim()) parts.push(line.trim());
  }
  return Array.from(parts.join(" ").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 240).join("");
}

// Stable identities also cover historical snapshots and older workflow senders.
export function normalizeActivity(payload) {
  if (payload.kind === "Workflow") {
    const run = payload.url.match(/^https:\/\/github\.com\/dericg\/wahl\/actions\/runs\/(\d+)(?:\/attempts\/\d+)?$/);
    if (!run || !publicWorkflow(payload.summary.trim())) return null;
    return { ...payload, sourceId: `workflow:${run[1]}`, url: `https://github.com/dericg/wahl/actions/runs/${run[1]}` };
  }
  if (payload.kind === "Issue") {
    const issue = payload.url.match(/^https:\/\/github\.com\/dericg\/wahl\/issues\/(\d+)\/?$/);
    if (issue) return { ...payload, sourceId: `issue:${issue[1]}:${new Date(payload.occurredAt).toISOString()}`, url: `https://github.com/dericg/wahl/issues/${issue[1]}` };
  }
  return payload;
}

export function validateActivity(payload) {
  if (typeof payload.sourceId !== "string" || !sourceId.test(payload.sourceId)) return "A valid source ID is required";
  if (!kinds.has(payload.kind)) return "Unsupported activity kind";
  if (typeof payload.summary !== "string" || Array.from(payload.summary.trim()).length < 1 || Array.from(payload.summary).length > 320) return "Activity summary must be between 1 and 320 characters";
  if (typeof payload.url !== "string" || !repositoryUrl.test(payload.url)) return "A Wahl repository URL is required";
  if (typeof payload.occurredAt !== "string" || !Number.isFinite(Date.parse(payload.occurredAt))) return "A valid activity timestamp is required";
  return null;
}
