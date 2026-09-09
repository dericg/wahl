import { briefThought, validateBrief } from "../supabase/functions/_shared/wahl-brief.js";

export async function requestConfirmedChange(confirmedText, { addPost, sendFix }) {
  if (typeof confirmedText !== "string" || !confirmedText.startsWith("#fix ") ||
      !confirmedText.slice(5).trim() || [...confirmedText].length > 320) return false;
  const post = await addPost({ text: confirmedText, audience: "private" });
  if (!post) return false;
  return sendFix(post.id);
}

// Only confirm can hand off a request. A generation counter discards cancelled
// or superseded responses; consume confirmation before awaiting side effects.
export function createBriefReview({ generate, onRequest, onChange }) {
  let generation = 0;
  let state = { status: "idle", brief: null, error: "" };
  const update = (next) => { state = next; onChange(state); };
  return {
    async prepare(messages) {
      if (state.status === "submitting") return;
      const current = ++generation;
      update({ status: "preparing", brief: null, error: "" });
      try {
        const brief = validateBrief(await generate(messages));
        if (current === generation) update({ status: "review", brief, error: "" });
      } catch (error) {
        if (current === generation) update({ status: "idle", brief: null, error: error.message });
      }
    },
    edit(text) {
      if (state.status === "review") update({ ...state, brief: { ...state.brief, text }, error: "" });
    },
    cancel() {
      if (state.status === "submitting") return;
      generation++;
      update({ status: "idle", brief: null, error: "" });
    },
    async confirm() {
      if (state.status !== "review") return;
      let text;
      try { text = briefThought(state.brief); }
      catch (error) { update({ ...state, error: error.message }); return; }
      update({ status: "submitting", brief: state.brief, error: "" });
      try {
        if (!await onRequest(text)) throw new Error("The request could not be completed. Check its private thought on the wall before trying again.");
        update({ status: "sent", brief: null, error: "" });
      } catch (error) {
        update({ status: "idle", brief: null, error: error.message });
      }
    },
  };
}
