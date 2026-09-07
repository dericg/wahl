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

export function summarizeActivity(activities) {
  const labels = {
    Commit: ["commit", "commits"],
    Issue: ["issue update", "issue updates"],
    "Pull request": ["pull request update", "pull request updates"],
    Deployment: ["deployment update", "deployment updates"],
    Workflow: ["workflow result", "workflow results"],
  };
  const counts = new Map();
  for (const activity of activities) counts.set(activity.kind, (counts.get(activity.kind) || 0) + 1);
  return [...counts].map(([kind, count]) => {
    const label = labels[kind] || ["update", "updates"];
    return `${count} ${label[count === 1 ? 0 : 1]}`;
  }).join(" · ");
}

export function activityHighlights(activities) {
  const work = activities.filter((activity) => ["Commit", "Pull request", "Issue"].includes(activity.kind));
  const seen = new Set();
  return (work.length ? work : activities).filter((activity) => {
    const identity = `${activity.kind}\u0000${activity.summary}`;
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
