export const FEED_PAGE_SIZE = 20;

// Preserve Postgres sub-millisecond precision at page boundaries.
export function timestampKey(value) {
  const iso = new Date(value).toISOString();
  const fraction = String(value).match(/\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/)?.[1] || "";
  return iso.slice(0, 19) + "." + fraction.padEnd(6, "0").slice(0, 6);
}

export function feedSource(client, table) {
  const thought = table === "posts";
  const date = thought ? "created_at" : "occurred_at";
  const id = thought ? "id" : "source_id";
  const columns = thought ? "id,text,audience_type,created_at" : "source_id,kind,summary,url,occurred_at";
  return async (cursor, limit) => {
    let query = client.from(table).select(columns)
      .order(date, { ascending: false }).order(id, { ascending: true }).limit(limit);
    if (!thought) {
      // Do not let internal automation records consume an entire page before
      // visitor-facing project notes are reached.
      query = query.in("kind", ["Commit", "Issue", "Pull request", "Deployment"])
        .neq("url", "https://github.com/dericg/wahl/deployments");
    }
    if (cursor) {
      // Quote PostgREST values; activity IDs may contain timestamp punctuation.
      const time = JSON.stringify(cursor[date]);
      const key = JSON.stringify(cursor[id]);
      query = query.or(`${date}.lt.${time},and(${date}.eq.${time},${id}.gt.${key})`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  };
}

// Read a bounded window from each source, then consume only their shared newest
// prefix. Unconsumed rows are fetched again using the last *consumed* cursor.
// This keeps a busy source from skipping older rows in the quieter source.
export async function loadFeedPage({ loadPosts, loadActivity, cursor = {}, limit = FEED_PAGE_SIZE }) {
  const [posts, activity] = await Promise.all([
    loadPosts(cursor.posts, limit + 1), loadActivity(cursor.activity, limit + 1),
  ]);
  let p = 0;
  let a = 0;
  while (p + a < limit && (p < posts.length || a < activity.length)) {
    if (p < posts.length && (a === activity.length || timestampKey(posts[p].created_at) >= timestampKey(activity[a].occurred_at))) p += 1;
    else a += 1;
  }
  return {
    posts: posts.slice(0, p), activity: activity.slice(0, a),
    cursor: { posts: p ? posts[p - 1] : cursor.posts, activity: a ? activity[a - 1] : cursor.activity },
    hasMore: p < posts.length || a < activity.length,
  };
}

export function appendPosts(current, incoming) {
  return [...new Map([...current, ...incoming].map((post) => [post.id, post])).values()];
}
