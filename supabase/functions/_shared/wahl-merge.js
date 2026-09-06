const repository = "dericg/wahl";
const shaPattern = /^[a-f0-9]{40}$/;

function failure(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

export function pullNumber(url) {
  const match = typeof url === "string" && url.match(/^https:\/\/github\.com\/dericg\/wahl\/pull\/([1-9]\d*)$/);
  const number = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(number)) throw failure("No Wahl pull request is linked to this thought.", 400);
  return number;
}

export function mergeReadiness({ pull, branch, comparison, runs, number }) {
  if (pull.number !== number || pull.base?.repo?.full_name !== repository || pull.base?.ref !== "main" ||
      pull.head?.repo?.full_name !== repository || !shaPattern.test(pull.head?.sha || "")) {
    return "Only Wahl pull requests targeting main can be merged here.";
  }
  if (pull.merged) return "This pull request has already been merged.";
  if (pull.state !== "open" || pull.draft !== false) return "The pull request must be open and ready for review.";
  if (pull.mergeable !== true || pull.mergeable_state !== "clean") return "GitHub has not confirmed that all merge requirements are satisfied. Check the pull request and try again.";
  if (!shaPattern.test(branch.sha || "") || pull.base.sha !== branch.sha || comparison.behind_by !== 0) {
    return "Update the branch with current main, then validate and review it again.";
  }
  // Require this repository's tests/build workflow, not an arbitrary successful check.
  const latest = runs.workflow_runs?.filter((run) => run.head_sha === pull.head.sha &&
    run.event === "pull_request" && run.path === ".github/workflows/ci.yml" &&
    run.repository?.full_name === repository && run.pull_requests?.some((pr) => pr.number === number))
    .sort((a, b) => b.id - a.id)[0];
  if (!latest || latest.status !== "completed" || latest.conclusion !== "success") {
    return "Validate Wahl must pass tests and build for this commit before merging.";
  }
  return null;
}

// This path is called only by an authenticated owner action, never by dispatch
// or a workflow callback. Its token is separate from WAHL_GITHUB_TOKEN.
export async function reviewOrMerge({ owner, userId, post, automation, input, token, fetchImpl = fetch }) {
  if (owner !== true || !userId) throw failure("Owner access required.", 403);
  if (!post || post.author_id !== userId || post.audience_type !== "private" || !/#fix\b/i.test(post.text) ||
      !automation || automation.post_id !== post.id) throw failure("An eligible private fix request is required.", 403);
  if (!["review_pull_request", "merge_pull_request"].includes(input.action)) throw failure("Invalid action.", 400);
  const number = pullNumber(automation.pull_request_url);
  if (!token) throw failure("Merging from Wahl is not configured. Review this pull request on GitHub.", 503);
  const merging = input.action === "merge_pull_request";
  if (merging && (input.reviewed !== true || !shaPattern.test(input.headSha || "") || !shaPattern.test(input.baseSha || ""))) {
    throw failure("Confirm your review of the current commit before merging.", 400);
  }
  async function github(path, body) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/${path}`, {
      method: body ? "PUT" : "GET",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Wahl-Owner-Review", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw failure(body
      ? "GitHub did not accept the merge. Refresh and review the pull request on GitHub."
      : "GitHub review details are unavailable. Try again or review on GitHub.", 502);
    return response.json();
  }
  const pull = await github(`pulls/${number}`);
  // Never interpolate unvalidated GitHub payloads into subsequent URLs.
  if (!shaPattern.test(pull.head?.sha || "")) throw failure("The pull request commit could not be verified.");
  const branch = await github("commits/main");
  if (!shaPattern.test(branch.sha || "")) throw failure("The main branch could not be verified.");
  const [comparison, runs] = await Promise.all([
    github(`compare/${branch.sha}...${pull.head.sha}`),
    github(`actions/workflows/ci.yml/runs?head_sha=${pull.head.sha}&event=pull_request&per_page=100`),
  ]);
  const reason = mergeReadiness({ pull, branch, comparison, runs, number });
  const review = { number, headSha: pull.head.sha, baseSha: branch.sha, ready: !reason,
    merged: pull.merged === true, message: reason || "Tests and build passed. Review the change before merging." };
  if (!merging) return { review };
  if (reason) throw failure(reason);
  if (input.headSha !== pull.head.sha || input.baseSha !== branch.sha) throw failure("The pull request or main changed. Refresh and review the new commit before merging.");
  const result = await github(`pulls/${number}/merge`, { sha: input.headSha, merge_method: "squash" });
  if (result.merged !== true) throw failure("GitHub did not merge the pull request. Refresh its status before trying again.");
  return { review: { ...review, ready: false, merged: true, message: "Pull request merged. Publishing remains a separate step." } };
}
