export function validateFixRequest({ owner, userId, post }) {
  if (!owner) return { error: "Owner access required", status: 403 };
  if (!post || post.author_id !== userId || post.audience_type !== "private" || !/#fix\b/i.test(post.text)) {
    return { error: "This post is not an eligible private fix request", status: 400 };
  }
  return null;
}
