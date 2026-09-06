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
  const entries = [...remote, ...releaseActivity(fallbackCommits)];
  return [...new Map(entries.map((entry) => [`${entry.kind}\u0000${entry.summary}\u0000${entry.url}\u0000${entry.occurred_at}`, entry])).values()]
    .filter((entry) => validDate(entry.occurred_at))
    .sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at));
}

export function wallEntries(posts = [], activity = []) {
  return [
    ...posts.map((post) => ({ ...post, entry_type: "thought" })),
    ...activity.map((entry) => ({ ...entry, id: `github:${entry.source_id}`, created_at: entry.occurred_at, entry_type: "activity" })),
  ].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || String(left.id).localeCompare(String(right.id)));
}

export function filterWallEntries(entries, filter) {
  if (filter === "issues") {
    const issues = entries.filter((entry) => entry.entry_type === "activity" && entry.kind === "Issue");
    const byIssue = new Map();
    for (const entry of issues) if (!byIssue.has(entry.url)) byIssue.set(entry.url, entry);
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
    return [{ sourceId: `issue:${issue.number}:${payload.action}:${issue.updated_at}`, kind: "Issue", summary: bounded(`${payload.action} #${issue.number} · ${issue.title}`), url: issue.html_url, occurredAt: issue.updated_at }];
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
    return [{ sourceId: `workflow:${run.id}:${run.run_attempt || 1}`, kind: "Workflow", summary: `${run.name} · ${run.conclusion || run.status}`, url: run.html_url, occurredAt: run.updated_at }];
  }

  return [];
}

export function snapshotActivity({ commits = [], issues = [], pulls = [], deployments = [], runs = [] } = {}) {
  const commitEntries = commits.map((commit) => ({ sourceId: `commit:${commit.sha}`, kind: "Commit", summary: bounded(String(commit.commit?.message || "Repository update").split("\n")[0]), url: commit.html_url, occurredAt: commit.commit?.committer?.date }));
  const issueEntries = issues.filter((issue) => !issue.pull_request).map((issue) => ({ sourceId: `issue:${issue.number}:${issue.state === "closed" ? "closed" : "opened"}:${issue.updated_at}`, kind: "Issue", summary: bounded(`${issue.state} #${issue.number} · ${issue.title}`), url: issue.html_url, occurredAt: issue.updated_at }));
  const pullEntries = pulls.map((pull) => ({ sourceId: `pr:${pull.number}:snapshot:${pull.updated_at}`, kind: "Pull request", summary: bounded(`${pull.merged_at ? "merged" : pull.state} #${pull.number} · ${pull.title}`), url: pull.html_url, occurredAt: pull.merged_at || pull.updated_at }));
  const deploymentEntries = deployments.map((deployment) => ({ sourceId: `deployment:${deployment.id}:snapshot`, kind: "Deployment", summary: `${deployment.environment || "Production"} · requested`, url: `${repositoryUrl}/deployments`, occurredAt: deployment.created_at }));
  const workflowEntries = runs.map((run) => ({ sourceId: `workflow:${run.id}:${run.run_attempt || 1}`, kind: "Workflow", summary: `${run.name} · ${run.conclusion || run.status}`, url: run.html_url, occurredAt: run.updated_at }));
  return [...commitEntries, ...issueEntries, ...pullEntries, ...deploymentEntries, ...workflowEntries];
}
