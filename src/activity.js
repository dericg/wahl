const repository = "dericg/wahl";
const github = `https://github.com/${repository}`;
const api = `https://api.github.com/repos/${repository}`;

function event(id, kind, created_at, text, path) {
  if (!Number.isFinite(Date.parse(created_at))) return null;
  return {
    id: `github:${id}`,
    kind,
    created_at,
    text: Array.from(text).slice(0, 320).join(""),
    url: `${github}/${path}`,
  };
}

export function commitEvents(commits) {
  return commits.map((commit) => {
    const hash = commit.sha || commit.hash;
    if (!/^[a-f\d]{7,40}$/i.test(hash)) return null;
    return event(`commit:${hash}`, "Commit", commit.commit?.committer?.date || commit.date,
      commit.commit?.message?.split("\n")[0] || commit.message || "Commit",
      `commit/${hash}`);
  }).filter(Boolean);
}

export function issueEvents(items, pullRequests = false) {
  return items.flatMap((item) => {
    if (!Number.isSafeInteger(item.number) || (!pullRequests && item.pull_request)) return [];
    const type = pullRequests ? "pr" : "issue";
    const kind = pullRequests ? "Pull request" : "Issue";
    const path = `${pullRequests ? "pull" : "issues"}/${item.number}`;
    const title = `#${item.number} · ${item.title || kind}`;
    return [
      event(`${type}:${item.number}:opened`, kind, item.created_at, `Opened ${title}`, path),
      item.merged_at
        ? event(`${type}:${item.number}:merged`, kind, item.merged_at, `Merged ${title}`, path)
        : item.closed_at && event(`${type}:${item.number}:closed`, kind, item.closed_at, `Closed ${title}`, path),
    ].filter(Boolean);
  });
}

export function deploymentEvents(deployments) {
  return deployments.flatMap((deployment) => {
    if (!Number.isSafeInteger(deployment.id)) return [];
    const name = deployment.environment || "Deployment";
    const path = "deployments";
    const status = deployment.latestStatus;
    return [
      event(`deployment:${deployment.id}:created`, "Deployment", deployment.created_at,
        `${name} · requested`, path),
      status && event(`deployment:${deployment.id}:status:${status.id}`, "Deployment", status.created_at,
        `${name} · ${String(status.state || "pending").replaceAll("_", " ")}`, path),
    ].filter(Boolean);
  });
}

export function workflowEvents(runs) {
  return runs.map((run) => {
    if (!Number.isSafeInteger(run.id)) return null;
    const status = String(run.conclusion || run.status || "pending").replaceAll("_", " ");
    return event(`workflow:${run.id}`, "Workflow", run.updated_at || run.created_at,
      `${run.name || "Workflow"} · ${status}`, `actions/runs/${run.id}`);
  }).filter(Boolean);
}

export function wallEntries(posts, activity) {
  return [
    ...posts.map((post) => ({ ...post, entryType: "thought" })),
    ...activity.map((item) => ({ ...item, entryType: "activity" })),
  ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id));
}

// Public, read-only requests: never send Supabase credentials or a GitHub token.
// Each source can fail independently without hiding thoughts or other activity.
export async function loadActivity({ signal, fallbackCommits = [], fetcher = fetch } = {}) {
  async function get(path) {
    const response = await fetcher(`${api}/${path}`, {
      signal,
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error("Repository activity unavailable");
    return response.json();
  }

  const results = await Promise.allSettled([
    get("commits?per_page=10").then(commitEvents),
    get("issues?state=all&sort=updated&direction=desc&per_page=10").then((items) => issueEvents(items)),
    get("pulls?state=all&sort=updated&direction=desc&per_page=10").then((items) => issueEvents(items, true)),
    get("deployments?per_page=5").then(async (deployments) => {
      const statuses = await Promise.allSettled(deployments.map(async (deployment) => {
        const items = await get(`deployments/${encodeURIComponent(deployment.id)}/statuses?per_page=1`);
        return { ...deployment, latestStatus: items[0] };
      }));
      return {
        events: deploymentEvents(statuses.map((result, index) => result.status === "fulfilled" ? result.value : deployments[index])),
        unavailable: statuses.some((result) => result.status === "rejected"),
      };
    }),
    get("actions/runs?per_page=10").then((data) => workflowEvents(data.workflow_runs)),
  ]);

  const events = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value.events || result.value;
    return index === 0 ? commitEvents(fallbackCommits) : [];
  });
  return {
    events,
    unavailable: results.some((result) => result.status === "rejected" || result.value.unavailable),
  };
}
