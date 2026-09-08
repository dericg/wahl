import { normalizeActivity } from "../supabase/functions/_shared/wahl-activity-policy.js";
import { timestampKey } from "./feed.js";

const repositoryUrl = "https://github.com/dericg/wahl";

function bounded(value) {
  return Array.from(String(value || "Repository update")).slice(0, 320).join("");
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function readableTopic(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/^\s*\[Wahl fix\]\s*/i, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
    .filter((entry) => validDate(entry.occurred_at)
      && ["Commit", "Issue", "Pull request", "Deployment"].includes(entry.kind)
      && !(entry.kind === "Deployment" && entry.url === `${repositoryUrl}/deployments`));
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
  const match = /^([^·]+) · (\w+)(?: · #(\d+) · ([\s\S]+))?$/.exec(String(activity.summary || ""));
  const detail = match?.[4]?.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
  return match ? {
    site: match[1].trim().toLowerCase(),
    state: match[2],
    pullNumber: match[3],
    title: detail?.startsWith("reader:") ? undefined : detail,
    readerSummary: detail?.startsWith("reader:") ? detail.slice(7).trim() : undefined,
  } : null;
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
    Commit: ["change to Wahl", "changes to Wahl"],
    Issue: ["idea or improvement", "ideas or improvements"],
    "Pull request": ["change being reviewed", "changes being reviewed"],
    Deployment: ["new test version", "new test versions"],
  };
  const counts = new Map();
  for (const activity of activityOutcomes(activities)) {
    const kind = activity.kind === "Workflow" && activity.summary?.startsWith("Validate Wahl · ") ? "checks"
      : activity.kind === "Workflow" && activity.summary?.startsWith("Turn a Wahl thought into a pull request · ") ? "proposals"
        : activity.kind;
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return [...counts].map(([kind, count]) => {
    const label = labels[kind] || ["update", "updates"];
    return `${count} ${label[count === 1 ? 0 : 1]}`;
  }).join(" · ");
}

export function activityWorkSummary(activity) {
  const summary = String(activity.summary || "");
  if (activity.kind === "Commit") {
    const title = readableTopic(summary);
    const topic = title ? `“${Array.from(title).slice(0, 180).join("")}${Array.from(title).length > 180 ? "…" : ""}”` : "an update to Wahl";
    return `Deric saved work on ${topic}. It is part of Wahl's code, but this note does not say whether it is on the website yet.`;
  }
  if (["Issue", "Pull request"].includes(activity.kind)) {
    const match = /^(\w+) #(\d+)(?: · ([\s\S]*)|$)/.exec(summary);
    const state = match?.[1];
    // Quote the title as a name, never as evidence of a fix or a publication.
    // React renders this bounded text directly, without HTML or Markdown.
    const title = readableTopic(match?.[3]);
    const topic = title ? `“${Array.from(title).slice(0, 180).join("")}${Array.from(title).length > 180 ? "…" : ""}”` : "an update to Wahl";
    if (activity.kind === "Issue") {
      if (["open", "opened", "reopened"].includes(state)) return `Deric plans to work on ${topic}. No change has been made yet.`;
      if (state === "closed") return `Deric finished considering ${topic}. This note alone does not say whether it became part of Wahl.`;
      return `Deric updated his plans for ${topic}.`;
    }
    if (state === "merged") return `Deric accepted this change: ${topic}. It is now part of Wahl and will appear when that version is published.`;
    if (state === "closed") return `Deric decided not to add this change: ${topic}.`;
    if (["open", "opened", "reopened"].includes(state)) return `Deric prepared this change: ${topic}. He is reviewing it before making it part of Wahl.`;
    return `Deric revised this proposed change: ${topic}. It is still being reviewed.`;
  }
  if (activity.kind === "Deployment") {
    const { site, state, pullNumber, title, readerSummary } = publishingRecord(activity) || {};
    const change = pullNumber && title
      ? ` It includes proposed change #${pullNumber}: “${Array.from(title).slice(0, 160).join("")}${Array.from(title).length > 160 ? "…" : ""}”.`
      : "";
    const readerChange = pullNumber && readerSummary
      ? ` ${Array.from(readerSummary).slice(0, 240).join("")}${Array.from(readerSummary).length > 240 ? "…" : ""}`
      : "";
    // github-pages proves test publication. The shared test environment also
    // records validation and service preparation, so its success alone cannot.
    const website = site === "github-pages";
    const preparation = site === "test";
    if (state === "success") {
      if (website && readerChange) return `Deric published a new test version of Wahl.${readerChange}`;
      if (website) return change
        ? `Deric published a new test version of Wahl.${change} It is ready to try.`
        : "A new test version of Wahl is ready. It includes the proposed changes and can now be reviewed.";
      if (preparation) return "Wahl finished checking or preparing its test version. This does not confirm that the proposed changes are available to review yet.";
      return "Wahl finished an attempt to publish an update. The notes do not identify the website that received it, so they cannot confirm where readers can see the changes.";
    }
    if (["failure", "error"].includes(state)) {
      if (preparation) return "Wahl could not finish checking or preparing its test version. This attempt does not confirm that anything new is ready to review. Some preparation may have finished before it stopped.";
      return "Wahl could not publish the proposed update. The previous version is still available.";
    }
    if (["requested", "queued", "pending", "in_progress"].includes(state)) {
      return "A new version of Wahl is still being prepared. Nothing new is ready to review from this attempt yet.";
    }
    if (state === "cancelled") return "Wahl stopped preparing the proposed update before it finished. This attempt has no new version ready to review.";
    if (state === "inactive") return "This attempt to publish Wahl is no longer active. The notes do not say whether it was replaced or removed, so they cannot confirm what readers can view now.";
    return "Wahl recorded an attempt to publish an update, but its outcome is missing or unclear. The notes do not confirm that anything new is ready to review.";
  }
  if (activity.kind === "Workflow") {
    const match = /^([^·]+) · (\w+)$/.exec(summary);
    const name = match?.[1].trim();
    const state = match?.[2];
    const checks = name === "Validate Wahl";
    const proposal = name === "Turn a Wahl thought into a pull request";
    if (!checks && !proposal) return "Wahl recorded work, but the notes do not explain what it tried to do or whether it finished. They cannot confirm a change for readers.";
    if (state === "success") {
      if (checks) return "Wahl passed its checks for problems in the code. The work can move on to review. Passing these checks does not publish a new version or prove that every problem is fixed.";
      // A successful run may finish without preparing a proposal. There is no
      // stored issue/PR link, so nearby titles cannot prove what it changed.
      return "Wahl finished trying to prepare a requested change. The notes do not say whether it produced a proposal for Deric to review. They do not confirm a fix or a new website version.";
    }
    const task = checks ? "checking its code for problems" : "preparing a requested change for Deric to review";
    const outcomes = {
      failure: `Wahl could not finish ${task}.`,
      cancelled: `Wahl stopped ${task} before it finished.`,
      timed_out: `Wahl ran out of time while ${task}. It did not finish.`,
      action_required: `Wahl needs help before it can finish ${task}.`,
      startup_failure: `Wahl could not start ${task}.`,
      queued: `Wahl is waiting to start ${task}.`,
      in_progress: `Wahl is still ${task}. It has not finished yet.`,
    };
    const outcome = Object.hasOwn(outcomes, state) ? outcomes[state] : `Wahl tried ${task}, but the notes do not say whether it finished.`;
    return `${outcome} ${checks
      ? "These notes do not confirm that the code passed its checks, so it still needs review. This does not confirm any change to the website."
      : "The notes do not confirm that a proposed change is ready to review. They do not show that the requested problem was fixed."}`;
  }
  return "Wahl recorded work, but the notes do not explain what it tried to do or whether it finished. They cannot confirm a change for readers.";
}

export function activityHighlights(activities) {
  const seen = new Set();
  return activityOutcomes(activities).filter((activity) => {
    // The collapsed explanation names a proposed change once. Every separate
    // publishing attempt remains available in the chronological details.
    const publishing = publishingRecord(activity);
    const identity = activity.kind === "Deployment" && publishing?.pullNumber ? `Deployment\u0000${publishing.pullNumber}`
      : activity.kind === "Deployment" ? activity
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
    // GitHub's generic lifecycle event does not identify the proposed change.
    // deploy-test.yml records one useful, PR-specific result after publication.
    return [];
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
  const deploymentEntries = [];
  const workflowEntries = runs.flatMap((run) => activityPayloads("workflow_run", { repository: { full_name: "dericg/wahl" }, workflow_run: run }));
  return [...commitEntries, ...issueEntries, ...pullEntries, ...deploymentEntries, ...workflowEntries];
}
