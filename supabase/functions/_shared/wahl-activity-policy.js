const kinds = new Set(["Commit", "Issue", "Pull request", "Deployment", "Workflow"]);
const sourceId = /^[A-Za-z0-9:._-]{1,160}$/;
const repositoryUrl = /^https:\/\/github\.com\/dericg\/wahl(?:\/|$)/;

export function validateActivity(payload) {
  if (typeof payload.sourceId !== "string" || !sourceId.test(payload.sourceId)) return "A valid source ID is required";
  if (!kinds.has(payload.kind)) return "Unsupported activity kind";
  if (typeof payload.summary !== "string" || Array.from(payload.summary.trim()).length < 1 || Array.from(payload.summary).length > 320) return "Activity summary must be between 1 and 320 characters";
  if (typeof payload.url !== "string" || !repositoryUrl.test(payload.url)) return "A Wahl repository URL is required";
  if (typeof payload.occurredAt !== "string" || !Number.isFinite(Date.parse(payload.occurredAt))) return "A valid activity timestamp is required";
  return null;
}
