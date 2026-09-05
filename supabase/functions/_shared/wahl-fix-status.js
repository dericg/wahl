const allowedStatuses = new Set(["working", "pr_ready", "no_change", "failed"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pullRequestUrl = /^https:\/\/github\.com\/dericg\/wahl\/pull\/\d+$/;

export function validateAutomationUpdate({ requestId, status, pullRequestUrl: url }) {
  if (typeof requestId !== "string" || !uuid.test(requestId)) {
    return { error: "A valid automation request ID is required", status: 400 };
  }
  if (!allowedStatuses.has(status)) {
    return { error: "Unsupported automation status", status: 400 };
  }
  if (status === "pr_ready" && (typeof url !== "string" || !pullRequestUrl.test(url))) {
    return { error: "A Wahl pull request URL is required", status: 400 };
  }
  if (status !== "pr_ready" && url != null) {
    return { error: "Only a ready pull request may include a URL", status: 400 };
  }
  return null;
}
