import { normalizeActivity, publicWorkflow } from "../supabase/functions/_shared/wahl-activity-policy.js";
import { timestampKey } from "./feed.js";

const repositoryUrl = "https://github.com/dericg/wahl";

function bounded(value) {
  return Array.from(String(value || "Repository update")).slice(0, 320).join("");
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function releaseActivity(commits = []) {
  return commits.flatMap((commit) => {
    if (!/^[a-f\d]{7,40}$/i.test(commit.hash || "") || !validDate(commit.date)) return [];
    return [{
      source_id: `commit:${commit.hash}`,
      kind: "Commit",
      summary: bounded(commit.message),
      url: `${repositoryUrl}/commit/${commit.hash}`,
      occurred_at: commit.date,
    }];
  });
}

export function mergeActivity(remote = [], fallbackCommits = []) {
  const entries = [...remote, ...releaseActivity(fallbackCommits)]
    .filter((entry) => validDate(entry.occurred_at) && (entry.kind !== "Workflow" || publicWorkflow(entry.summary)));
  const byIdentity = new Map();
  for (const entry of entries) {
    const identity = entry.kind === "Workflow" ? entry.url.replace(/\/attempts\/\d+$/, "")
      : entry.kind === "Deployment" ? entry.source_id
        : `${entry.kind}\u0000${entry.url}\u0000${timestampKey(entry.occurred_at)}`;
    const previous = byIdentity.get(identity);
    if (!previous || timestampKey(entry.occurred_at) >= timestampKey(previous.occurred_at)) byIdentity.set(identity, entry);
  }
  return [...byIdentity.values()].sort((left, right) => timestampKey(right.occurred_at).localeCompare(timestampKey(left.occurred_at)));
}

export function wallEntries(posts = [], activity = []) {
  return [
    ...posts.map((post) => ({ ...post, entry_type: "thought" })),
    ...activity.map((entry) => ({ ...entry, id: `github:${entry.source_id}`, created_at: entry.occurred_at, entry_type: "activity" })),
  ].sort((left, right) => timestampKey(right.created_at).localeCompare(timestampKey(left.created_at)) || String(left.id).localeCompare(String(right.id)));
}

export function groupConsecutiveActivity(entries) {
  const groups = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (entry.entry_type === "activity" && previous?.entry_type === "activity-group") {
      previous.activities.push(entry);
    } else if (entry.entry_type === "activity" && previous?.entry_type === "activity") {
      groups[groups.length - 1] = {
        id: `group:${previous.id}`,
        entry_type: "activity-group",
        created_at: previous.created_at,
        activities: [previous, entry],
      };
    } else {
      groups.push(entry);
    }
  }
  return groups;
}

function publishingRecord(activity) {
  if (activity.kind !== "Deployment") return null;
  const match = /^([^·]+) · (\w+)$/.exec(String(activity.summary || ""));
  return match ? { site: match[1].trim().toLowerCase(), state: match[2] } : null;
}

const finalPublishingStates = new Set(["success", "failure", "error", "inactive", "cancelled"]);

export function activityOutcomes(activities) {
  // Deployment URLs all point to the same page. Only a shared deployment ID
  // proves that records describe the same attempt; timing and titles do not.
  const attempts = new Map();
  for (const activity of activities) {
    const id = activity.kind === "Deployment" && /^deployment:(\d+):[^:]+$/.exec(activity.source_id || "")?.[1];
    if (!id) continue;
    const previous = attempts.get(id);
    const final = finalPublishingStates.has(publishingRecord(activity)?.state);
    const previousFinal = finalPublishingStates.has(publishingRecord(previous || {})?.state);
    const time = validDate(activity.occurred_at) ? timestampKey(activity.occurred_at) : "";
    const previousTime = validDate(previous?.occurred_at) ? timestampKey(previous.occurred_at) : "";
    if (!previous || (final && !previousFinal) || (final === previousFinal && time > previousTime)) {
      attempts.set(id, activity);
    }
  }
  const seen = new Set();
  return activities.filter((activity) => {
    const id = activity.kind === "Deployment" && /^deployment:(\d+):[^:]+$/.exec(activity.source_id || "")?.[1];
    if (!id) return true;
    if (seen.has(id) || attempts.get(id) !== activity) return false;
    seen.add(id);
    return true;
  });
}

export function summarizeActivity(activities) {
  const labels = {
    Commit: ["saved code change", "saved code changes"],
    Issue: ["request update", "request updates"],
    "Pull request": ["proposed change update", "proposed change updates"],
    Deployment: ["publishing attempt", "publishing attempts"],
    Workflow: ["automatic task result", "automatic task results"],
  };
  const counts = new Map();
  for (const activity of activityOutcomes(activities)) counts.set(activity.kind, (counts.get(activity.kind) || 0) + 1);
  return [...counts].map(([kind, count]) => {
    const label = labels[kind] || ["update", "updates"];
    return `${count} ${label[count === 1 ? 0 : 1]}`;
  }).join(" · ");
}

export function activityWorkSummary(activity) {
  const summary = String(activity.summary || "");
  if (activity.kind === "Commit") {
    return "A change to this site's code was saved. This keeps a record of the work for later review.";
  }
  if (["Issue", "Pull request"].includes(activity.kind)) {
    const match = /^(\w+) #(\d+)(?: · ([\s\S]*)|$)/.exec(summary);
    const state = match?.[1];
    const subject = activity.kind === "Issue" ? "Request" : "Proposed change";
    const label = `${subject}${match ? ` #${match[2]}` : ""}`;
    // Quote the title as a name, never as evidence of a fix or a publication.
    // React renders this bounded text directly, without HTML or Markdown.
    const title = match?.[3]?.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
    const topic = title ? ` Title: “${Array.from(title).slice(0, 160).join("")}${Array.from(title).length > 160 ? "…" : ""}”.` : "";
    if (activity.kind === "Issue") {
      if (["open", "opened", "reopened"].includes(state)) return `${label} is open. It tracks a problem or idea for Deric to consider.${topic}`;
      if (state === "closed") return `${label} was closed. The record does not say whether the problem was fixed.${topic}`;
      return `${label} was updated.${topic}`;
    }
    if (state === "merged") return `${label} was accepted. It still needs a publishing result to show that readers can see it.${topic}`;
    if (state === "closed") return `${label} was closed without being accepted.${topic}`;
    if (["open", "opened", "reopened"].includes(state)) return `${label} is ready for Deric to review. It has not been accepted yet.${topic}`;
    return `${label} was updated for review.${topic}`;
  }
  if (activity.kind === "Deployment") {
    const { site, state } = publishingRecord(activity) || {};
    // In Wahl, github-pages publishes the review website. The test environment
    // runs checks and updates shared services; its success is not publication.
    const website = site === "github-pages";
    if (state === "success") {
      if (website) return "A new test version of Wahl was published. It is ready for Deric to review.";
      if (site === "test") return "A step to prepare Wahl's test version finished. This record does not show a new version ready for review yet.";
      return "A publishing step finished. The record does not show whether a new version of Wahl is ready to view.";
    }
    if (["failure", "error"].includes(state)) {
      return "Publishing failed. This attempt did not make a new version ready to review. The prior version remains available.";
    }
    if (["requested", "queued", "pending", "in_progress"].includes(state)) {
      return "Work to publish Wahl is still underway. There is nothing new to review yet.";
    }
    if (state === "cancelled") return "Publishing stopped before it finished. There is nothing new to review from this attempt.";
    if (state === "inactive") return "This publishing attempt is no longer active. Its record does not show the version now available for review.";
    return "The publishing result is not clear. Check its notes to see whether a new version is ready to view.";
  }
  if (activity.kind === "Workflow") {
    const match = /^([^·]+) · (\w+)$/.exec(summary);
    const name = match?.[1];
    const state = match?.[2];
    const checks = name === "Validate Wahl";
    const proposal = name === "Turn a Wahl thought into a pull request";
    const task = checks ? "The automatic check of Wahl" : proposal ? "The automatic task to work on a requested change" : "An automatic task for Wahl";
    if (state === "success") {
      if (checks) return "Wahl passed its automatic checks. This helps catch problems before Deric reviews the work. It does not mean a new version was published.";
      // This task can also finish successfully without proposing a change.
      // Stored workflow records contain no issue/PR link, so do not associate
      // nearby titles or promise a fix based on a successful run alone.
      if (proposal) return "The automatic task finished looking into a requested change. It may have prepared work for Deric to review. This record does not say whether it made a change.";
      return "An automatic task finished. Its record does not say what changed for readers.";
    }
    const outcomes = {
      failure: "failed. The work needs attention before it can move forward.",
      cancelled: "stopped early. The work did not finish.",
      timed_out: "ran out of time. The work did not finish.",
      action_required: "needs help before the work can move forward.",
      startup_failure: "could not start. The work needs another try.",
      queued: "is waiting to start. There is nothing new to review yet.",
      in_progress: "is still underway. There is nothing new to review yet.",
    };
    return `${task} ${Object.hasOwn(outcomes, state) ? outcomes[state] : "has no clear result. Its notes may give more detail."}`;
  }
  return "Work on this site was recorded. The linked notes give more detail about what happened.";
}

export function activityHighlights(activities) {
  const seen = new Set();
  return activityOutcomes(activities).filter((activity) => {
    // Separate publishing attempts remain distinct even with identical results.
    const identity = activity.kind === "Deployment" ? activity
      : `${activity.kind}\u0000${activity.summary}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, 3);
}

export function filterWallEntries(entries, filter) {
  if (filter === "issues") {
    const issues = entries.filter((entry) => entry.entry_type === "activity" && entry.kind === "Issue")
      .sort((left, right) => timestampKey(right.created_at).localeCompare(timestampKey(left.created_at)) || String(right.source_id).localeCompare(String(left.source_id)));
    const byIssue = new Map();
    for (const entry of issues) {
      const identity = entry.url.replace(/[?#].*$/, "").replace(/\/$/, "");
      if (!byIssue.has(identity)) byIssue.set(identity, entry);
    }
    return [...byIssue.values()];
  }
  return entries;
}

export function activityPayloads(eventName, payload) {
  const repository = payload.repository?.full_name;
  if (repository !== "dericg/wahl") return [];

  if (eventName === "push" && payload.ref === "refs/heads/main") {
    return (payload.commits || []).map((commit) => ({
      sourceId: `commit:${commit.id}`,
      kind: "Commit",
      summary: bounded(String(commit.message || "Repository update").split("\n")[0]),
      url: `${repositoryUrl}/commit/${commit.id}`,
      occurredAt: commit.timestamp,
    }));
  }

  if (eventName === "issues") {
    const issue = payload.issue;
    return [normalizeActivity({ sourceId: `issue:${issue.number}:${payload.action}:${issue.updated_at}`, kind: "Issue", summary: bounded(`${issue.state || (payload.action === "closed" ? "closed" : "open")} #${issue.number} · ${issue.title}`), url: issue.html_url, occurredAt: issue.updated_at })];
  }

  if (eventName === "pull_request") {
    const pull = payload.pull_request;
    const action = payload.action === "closed" && pull.merged ? "merged" : payload.action;
    return [{ sourceId: `pr:${pull.number}:${action}:${pull.updated_at}`, kind: "Pull request", summary: bounded(`${action} #${pull.number} · ${pull.title}`), url: pull.html_url, occurredAt: pull.merged_at || pull.updated_at }];
  }

  if (eventName === "deployment_status") {
    const deployment = payload.deployment;
    const status = payload.deployment_status;
    return [{ sourceId: `deployment:${deployment.id}:${status.id}`, kind: "Deployment", summary: `${deployment.environment || "Production"} · ${status.state}`, url: `${repositoryUrl}/deployments`, occurredAt: status.created_at }];
  }

  if (eventName === "workflow_run") {
    const run = payload.workflow_run;
    if (run.status && run.status !== "completed") return [];
    const entry = normalizeActivity({ sourceId: `workflow:${run.id}`, kind: "Workflow", summary: `${run.name} · ${run.conclusion || run.status}`, url: run.html_url, occurredAt: run.updated_at });
    return entry ? [entry] : [];
  }

  return [];
}

export function snapshotActivity({ commits = [], issues = [], pulls = [], deployments = [], runs = [] } = {}) {
  const commitEntries = commits.map((commit) => ({ sourceId: `commit:${commit.sha}`, kind: "Commit", summary: bounded(String(commit.commit?.message || "Repository update").split("\n")[0]), url: commit.html_url, occurredAt: commit.commit?.committer?.date }));
  const issueEntries = issues.filter((issue) => !issue.pull_request).map((issue) => normalizeActivity({ sourceId: `issue:${issue.number}:${issue.state === "closed" ? "closed" : "opened"}:${issue.updated_at}`, kind: "Issue", summary: bounded(`${issue.state} #${issue.number} · ${issue.title}`), url: issue.html_url, occurredAt: issue.updated_at }));
  const pullEntries = pulls.map((pull) => ({ sourceId: `pr:${pull.number}:snapshot:${pull.updated_at}`, kind: "Pull request", summary: bounded(`${pull.merged_at ? "merged" : pull.state} #${pull.number} · ${pull.title}`), url: pull.html_url, occurredAt: pull.merged_at || pull.updated_at }));
  const deploymentEntries = deployments.map((deployment) => ({ sourceId: `deployment:${deployment.id}:snapshot`, kind: "Deployment", summary: `${deployment.environment || "Production"} · requested`, url: `${repositoryUrl}/deployments`, occurredAt: deployment.created_at }));
  const workflowEntries = runs.flatMap((run) => activityPayloads("workflow_run", { repository: { full_name: "dericg/wahl" }, workflow_run: run }));
  return [...commitEntries, ...issueEntries, ...pullEntries, ...deploymentEntries, ...workflowEntries];
}
