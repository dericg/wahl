import { useRef, useState } from "react";
import { supabase } from "./supabase";

export default function PullRequestReview({ postId }) {
  const [review, setReview] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function requestReview(action) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const { data: authData } = await supabase.auth.getSession();
      const accessToken = authData.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Sign in again to review this pull request.");
      const { data, error: invokeError } = await supabase.functions.invoke("dispatch-wahl-fix", {
        body: { postId, action, ...(action === "merge_pull_request" ? {
          headSha: review?.headSha, baseSha: review?.baseSha, reviewed,
        } : {}) },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (invokeError) {
        let message = "The pull request couldn’t be checked. Refresh before trying again.";
        try {
          const response = await invokeError.context?.json();
          if (typeof response?.error === "string") message = response.error;
        } catch { /* Use the fallback for non-JSON platform errors. */ }
        throw new Error(message);
      }
      if (!data?.review) throw new Error("Pull request status is unavailable. Refresh before trying again.");
      setReview(data.review);
    } catch (problem) {
      // A failed or uncertain merge must require another fresh review.
      setReview(null);
      setError(problem.message);
    } finally {
      setReviewed(false);
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="pull-request-review">
    <div role="status" aria-live="polite">
      {review && <p>{review.message}</p>}
      {error && <p>{error}</p>}
    </div>
    {review?.ready && <label className="merge-review-confirmation">
      <input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} />
      <span>I reviewed PR #{review.number} at {review.headSha.slice(0, 7)} against its issue, Wahl’s instructions, and current main, including the test site, keyboard behavior, and narrow layout.</span>
    </label>}
    <div className="fix-progress-actions">
      {!review?.merged && <button type="button" disabled={busy} onClick={() => requestReview("review_pull_request")}>{busy ? "Checking…" : review ? "Refresh merge status" : "Check merge readiness"}</button>}
      {review?.ready && <button type="button" disabled={busy || !reviewed} onClick={() => requestReview("merge_pull_request")}>{busy ? "Please wait…" : `Merge PR #${review.number}`}</button>}
    </div>
  </div>;
}
