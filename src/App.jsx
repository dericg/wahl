import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Globe2, Lock, LogIn, LogOut, Trash2 } from "lucide-react";
import { INITIAL_POSTS } from "./data";
import { isCloudConfigured, supabase } from "./supabase";
import ThoughtEditor from "./ThoughtEditor";
import PullRequestReview from "./PullRequestReview";
import { draftDetails, FormattedText } from "./formattedText";
import { fixPresentation, hasActiveFix } from "./fixStatus";
import { filterWallEntries, groupConsecutiveActivity, mergeActivity, summarizeActivity, wallEntries } from "./activity";
import { appendPosts, feedSource, loadFeedPage, timestampKey } from "./feed";
import { exactTime, timeAgo } from "./time";

const previewMode = import.meta.env.DEV && !isCloudConfigured;

function CardTime({ value, now }) {
  const exact = useMemo(() => exactTime(value), [value]);
  return <time className="card-time" dateTime={new Date(value).toISOString()}>
    <span>{timeAgo(value, now)}</span><span className="exact-time">{exact}</span>
  </time>;
}

function PersonalNote() {
  const [open, setOpen] = useState(false);
  return (
    <section className={`personal-note ${open ? "open" : ""}`}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span><small>A note from Deric</small><strong>Grow through mastery.</strong></span><ChevronDown size={17} />
      </button>
      {open && <div><p>For me, mastery isn’t perfection. It is the practice of showing up with intention, staying present through discomfort, and making thoughtful adjustments without abandoning the work—or myself.</p><p className="personal-refrain">Show up. Stay present. Make adjustments.</p></div>}
    </section>
  );
}

function ReleaseHistory() {
  const [open, setOpen] = useState(false);
  const { version, commits } = __WAHL_RELEASE__;
  const currentCommit = commits[0]?.hash;

  return (
    <section className={`release-history ${open ? "open" : ""}`} aria-label="Wahl release history">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>Version {version}{currentCommit ? ` · ${currentCommit}` : ""}</span>
        <ChevronDown size={13} />
      </button>
      {open && <div className="release-list">
        <small>Recent changes</small>
        {commits.length ? <ol>{commits.map((commit) => <li key={commit.hash}>
          <time dateTime={commit.date}>{commit.date}</time>
          <span>{commit.message}</span>
          <code>{commit.hash}</code>
        </li>)}</ol> : <p>Commit history is unavailable in this build.</p>}
      </div>}
    </section>
  );
}

function ActivityCard({ activity, now }) {
  return (
    <article className="post-card activity-card" aria-label={`${activity.kind} from GitHub`}>
      <header className="post-header">
        <div><strong>Wahl</strong><CardTime value={activity.occurred_at} now={now} /></div>
        <span className="activity-kind">{activity.kind}</span>
      </header>
      <p><a href={activity.url} target="_blank" rel="noreferrer">{activity.summary}</a></p>
    </article>
  );
}

function ActivityGroup({ activities, now }) {
  const latest = activities[0];
  return (
    <article className="post-card activity-card activity-group" aria-label={`${activities.length} updates from GitHub`}>
      <header className="post-header">
        <div><strong>Wahl</strong><CardTime value={latest.occurred_at} now={now} /></div>
        <span className="activity-kind">{activities.length} updates</span>
      </header>
      <p>{summarizeActivity(activities)}</p>
      <p className="activity-latest">Latest: <a href={latest.url} target="_blank" rel="noreferrer">{latest.summary}</a></p>
      <details className="activity-details">
        <summary>View {activities.length} updates</summary>
        <ol>{activities.map((activity) => <li key={activity.id}>
          <div className="post-header"><span className="activity-kind">{activity.kind}</span><CardTime value={activity.occurred_at} now={now} /></div>
          <p><a href={activity.url} target="_blank" rel="noreferrer">{activity.summary}</a></p>
        </li>)}</ol>
      </details>
    </article>
  );
}

function Composer({ onPost, busy }) {
  const [draft, setDraft] = useState(() => draftDetails([]));
  const [editorVersion, setEditorVersion] = useState(0);
  const [audience, setAudience] = useState("everyone");

  async function submit() {
    const { text } = draft;
    if (!draft.valid || busy) return;
    const effectiveAudience = draft.hasFix ? "private" : audience;
    if (effectiveAudience !== audience) setAudience(effectiveAudience);
    const saved = await onPost({ text, audience: effectiveAudience });
    if (saved) { setDraft(draftDetails([])); setEditorVersion((value) => value + 1); }
  }

  return (
    <section className="composer" aria-label="Create a post">
      <label id="thought-label">what’s the thought?</label>
      <ThoughtEditor key={editorVersion} onChange={setDraft} busy={busy} invalid={draft.length > 320} />
      <div className="audience-row" aria-label="Choose who can see this">
        <button className={`audience-pill ${audience === "private" ? "selected" : ""}`} onClick={() => setAudience("private")} type="button" aria-pressed={audience === "private"}><Lock size={13} />Only me</button>
        <button className={`audience-pill ${audience === "everyone" ? "selected" : ""}`} onClick={() => setAudience("everyone")} type="button" aria-pressed={audience === "everyone"}><Globe2 size={13} />Everyone</button>
      </div>
      <div className="composer-footer"><span id="thought-status" aria-live="polite">{draft.length > 320 ? `${draft.length} / 320 — shorten your thought to post` : draft.hasFix ? "#fix requests are always private" : draft.length ? `${draft.length} / 320 · includes formatting` : audience === "private" ? "a private draft, visible only to you" : "published to your public wall"}</span><button className="post-button" type="button" disabled={!draft.valid || busy} onClick={submit}>{busy ? "Posting…" : "Post"}</button></div>
    </section>
  );
}

function PostCard({ post, now, owner, onDelete, onSendFix, onRefreshFix, fix }) {
  const [progressOpen, setProgressOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [progressError, setProgressError] = useState("");
  const privatePost = post.audience_type === "private";
  const fixRequest = owner && privatePost && /#fix\b/i.test(post.text);
  const Icon = privatePost ? Lock : Globe2;
  const progress = fixPresentation(fix?.status);

  async function refreshProgress() {
    if (refreshing || previewMode || !fix?.id) return;
    setRefreshing(true);
    setProgressError("");
    try {
      await onRefreshFix(post.id);
    } catch {
      setProgressError("Progress couldn’t be refreshed. The last known status is still shown.");
    } finally {
      setRefreshing(false);
    }
  }

  function toggleProgress() {
    setProgressOpen((open) => !open);
    if (!progressOpen) refreshProgress();
  }

  return (
    <article className="post-card">
      <header className="post-header">
        <div><strong className="mine">Deric</strong><CardTime value={post.created_at} now={now} /></div>
        <div className="post-tools"><span className="audience-badge"><Icon size={12} />{privatePost ? "Only me" : "Everyone"}</span>{owner && <button className="delete-post" type="button" onClick={() => onDelete(post.id)} aria-label="Delete this post"><Trash2 size={13} /></button>}</div>
      </header>
      <p><FormattedText text={post.text} /></p>
      {fixRequest && <div className="fix-request">
        <span>{progress.label}</span>
        {fix ? <button type="button" onClick={toggleProgress} aria-expanded={progressOpen} aria-controls={`fix-progress-${post.id}`}>{progressOpen ? "Hide progress" : "View progress"}</button> : <button type="button" onClick={() => onSendFix(post.id)}>Send to Codex</button>}
        {fix && progressOpen && <div className="fix-progress" id={`fix-progress-${post.id}`}>
          <div role="status" aria-live="polite">
            <p>{previewMode ? "This is a local preview. No request was sent to Codex." : progress.description}</p>
            {fix.updated_at && <p className="fix-updated">Last updated <time dateTime={fix.updated_at}>{new Date(fix.updated_at).toLocaleString()}</time></p>}
            {progressError && <p>{progressError}</p>}
          </div>
          <div className="fix-progress-actions">
            {!previewMode && <button type="button" onClick={refreshProgress} disabled={refreshing || !fix.id}>{refreshing ? "Refreshing…" : "Refresh progress"}</button>}
            {fix.pull_request_url && <a href={fix.pull_request_url} target="_blank" rel="noreferrer">{fix.status === "closed" ? "View pull request" : "Review pull request"}</a>}
          </div>
          {!previewMode && fix.pull_request_url && fix.status !== "closed" && <PullRequestReview key={fix.pull_request_url} postId={post.id} />}
        </div>}
      </div>}
    </article>
  );
}

function SignIn({ session, owner }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn(event) {
    event.preventDefault();
    setMessage("Signing in…");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMessage(error ? "That email and password didn’t match." : "");
  }

  async function updatePassword(event) {
    event.preventDefault();
    setMessage("Saving…");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setMessage(error.message);
    else { setPassword(""); setChangingPassword(false); setMessage("Password saved."); }
  }

  if (!isCloudConfigured) return <span>{previewMode ? "Local preview" : "Read-only"}</span>;
  if (session && owner) return <div className="account-controls">
    {changingPassword ? <form className="sign-in" onSubmit={updatePassword}><input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" aria-label="New password" /><button type="submit">Save password</button></form> : <button className="quiet-button" type="button" onClick={() => { setChangingPassword(true); setMessage(""); }}>Set password</button>}
    <button className="quiet-button" type="button" onClick={() => supabase.auth.signOut()}><LogOut size={12} />Sign out</button>
    {message && <small className="account-message">{message}</small>}
  </div>;
  if (session) return <button className="quiet-button" type="button" onClick={() => supabase.auth.signOut()}><LogOut size={12} />Not authorized · sign out</button>;
  if (!open) return <button className="quiet-button" type="button" onClick={() => setOpen(true)}><LogIn size={12} />Owner sign in</button>;
  return <form className="sign-in password-sign-in" onSubmit={signIn}><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" aria-label="Email address" /><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" aria-label="Password" /><button type="submit">Sign in</button>{message && <small>{message}</small>}</form>;
}

export default function App() {
  const [posts, setPosts] = useState(() => previewMode ? INITIAL_POSTS.map((post) => ({ ...post, audience_type: post.audience === "private" ? "private" : "everyone", created_at: new Date(post.createdAt).toISOString() })) : []);
  const [session, setSession] = useState(null);
  const [owner, setOwner] = useState(previewMode);
  const [loading, setLoading] = useState(isCloudConfigured);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [fixes, setFixes] = useState({});
  const [activity, setActivity] = useState(() => mergeActivity([], __WAHL_RELEASE__.commits));
  const [activityUnavailable, setActivityUnavailable] = useState(false);
  const [feedFilter, setFeedFilter] = useState("all");
  const [now, setNow] = useState(Date.now);
  const [hasMore, setHasMore] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const pager = useRef(null);
  const loadedPosts = useRef(posts);
  const entries = useMemo(() => wallEntries(posts, activity), [posts, activity]);
  const visibleEntries = useMemo(() => filterWallEntries(entries, feedFilter), [entries, feedFilter]);
  const displayEntries = useMemo(() => feedFilter === "all" ? groupConsecutiveActivity(visibleEntries) : visibleEntries, [visibleEntries, feedFilter]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  async function loadFixes() {
    if (!supabase || !loadedPosts.current.length) return;
    const current = pager.current;
    const { data, error } = await supabase.from("automation_requests")
      .select("id,post_id,status,pull_request_url,updated_at").in("post_id", loadedPosts.current.map((post) => post.id));
    if (current === pager.current && !error) setFixes(Object.fromEntries((data || []).map((fix) => [fix.post_id, fix])));
  }

  async function loadOlder(current = pager.current) {
    if (!supabase || !current || current.pending) return;
    current.pending = true;
    setOlderLoading(true);
    try {
      const page = await loadFeedPage({
        cursor: current.cursor,
        loadPosts: feedSource(supabase, "posts"),
        loadActivity: async (cursor, limit) => {
          if (!current.fallback) {
            try { return await feedSource(supabase, "repository_activity")(cursor, limit); }
            catch (error) {
              // A failed first activity read must not hide thoughts. Later page
              // failures leave both cursors unchanged so Load older can retry.
              if (current.loaded) throw error;
              current.fallback = true;
            }
          }
          return mergeActivity([], __WAHL_RELEASE__.commits).filter((entry) => !cursor ||
            timestampKey(entry.occurred_at) < timestampKey(cursor.occurred_at) ||
            (timestampKey(entry.occurred_at) === timestampKey(cursor.occurred_at) && entry.source_id > cursor.source_id))
            .sort((left, right) => timestampKey(right.occurred_at).localeCompare(timestampKey(left.occurred_at)) || left.source_id.localeCompare(right.source_id)).slice(0, limit);
        },
      });
      if (current !== pager.current) return;
      current.cursor = page.cursor;
      current.loaded = true;
      setPosts((previous) => appendPosts(previous, page.posts).filter((post) => !current.deleted.has(post.id)));
      setActivity((previous) => mergeActivity([...previous, ...page.activity]));
      setActivityUnavailable(current.fallback);
      setHasMore(page.hasMore);
      setNotice("");
    } catch {
      if (current !== pager.current) return;
      setNotice("The wall couldn’t be loaded. Use Load older to try again.");
      setHasMore(true);
    } finally {
      current.pending = false;
      if (current === pager.current) { setLoading(false); setOlderLoading(false); }
    }
  }

  async function loadWall() {
    const current = { cursor: {}, fallback: false, loaded: false, pending: false, deleted: new Set() };
    pager.current = current;
    loadedPosts.current = [];
    setPosts([]);
    setActivity([]);
    setOwner(false);
    setFixes({});
    setLoading(true);
    setHasMore(false);
    setActivityUnavailable(false);
    await Promise.all([
      loadOlder(current),
      supabase.rpc("is_wahl_owner").then(({ data, error }) => {
        if (current === pager.current) setOwner(!error && Boolean(data));
      }).catch(() => { if (current === pager.current) setOwner(false); }),
    ]);
  }

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    let reload;
    let userId;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      const nextUserId = nextSession?.user.id || null;
      // INITIAL_SESSION starts the first page. Token refreshes for the same
      // reader keep the loaded history and scroll position intact.
      if (userId === nextUserId) return;
      userId = nextUserId;
      // Discard outstanding owner reads immediately when authentication changes.
      pager.current = null;
      loadedPosts.current = [];
      setPosts([]);
      setFixes({});
      setOwner(false);
      setLoading(true);
      window.clearTimeout(reload);
      reload = window.setTimeout(() => { if (active) loadWall(); }, 0);
    });
    return () => { active = false; pager.current = null; window.clearTimeout(reload); data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    loadedPosts.current = posts;
    if (owner) loadFixes();
  }, [posts, owner]);

  useEffect(() => {
    if (!supabase || !session || !owner || !hasActiveFix(fixes)) return undefined;
    const interval = window.setInterval(loadFixes, 10_000);
    return () => window.clearInterval(interval);
  }, [session, owner, fixes]);

  async function addPost({ text, audience }) {
    if (previewMode) {
      setPosts((current) => [{ id: crypto.randomUUID(), text, audience_type: audience, created_at: new Date().toISOString() }, ...current]);
      return true;
    }
    if (!supabase || !session || !owner) return false;
    const current = pager.current;
    setBusy(true);
    const { data, error } = await supabase.from("posts").insert({ author_id: session.user.id, text, audience_type: audience }).select("id,text,audience_type,created_at").single();
    setBusy(false);
    if (current !== pager.current) return false;
    if (error) { setNotice(error.message); return false; }
    setPosts((posts) => appendPosts(posts, [data]));
    return true;
  }

  async function deletePost(id) {
    if (previewMode) { setPosts((current) => current.filter((post) => post.id !== id)); return; }
    const current = pager.current;
    const { error } = await supabase.from("posts").delete().eq("id", id);
    if (current !== pager.current) return;
    if (error) setNotice(error.message);
    else { current?.deleted.add(id); setPosts((posts) => posts.filter((post) => post.id !== id)); }
  }

  async function sendFix(postId) {
    if (previewMode) {
      setFixes((current) => ({ ...current, [postId]: { post_id: postId, status: "queued" } }));
      return;
    }
    setFixes((current) => ({ ...current, [postId]: { post_id: postId, status: "queued" } }));
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData.session?.access_token;
    if (!accessToken) {
      setFixes((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
      setNotice("Your session expired. Sign in again, then resend the fix.");
      return;
    }
    const { data, error } = await supabase.functions.invoke("dispatch-wahl-fix", {
      body: { postId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      let message = "The fix couldn’t be sent. Please try again shortly.";
      try {
        const response = await error.context?.json();
        if (response?.error) message = response.error;
      } catch {
        // Keep the useful fallback when the platform returns a non-JSON error.
      }
      setFixes((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
      setNotice(message);
      return;
    }
    setFixes((current) => ({ ...current, [postId]: data.request }));
    setNotice("");
  }

  async function refreshFix(postId) {
    if (previewMode) return;
    if (!supabase || !session || !owner || !fixes[postId]?.id) throw new Error("Owner access required");
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData.session?.access_token;
    if (!accessToken) throw new Error("Session expired");
    const { data, error } = await supabase.functions.invoke("dispatch-wahl-fix", {
      body: { postId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error || !data?.request) throw new Error("Progress unavailable");
    setFixes((current) => ({ ...current, [postId]: data.request }));
  }

  return (
    <main><div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="shell">
      <header className="site-header">
        <div className="header-controls"><ReleaseHistory /><div className="owner-access"><SignIn session={session} owner={owner} /></div></div>
        <div className="brand"><div className="brand-line"><div className="wordmark">Wahl<span>.</span></div><span>by Deric Garza</span></div><p>thoughts, small observations, and things worth keeping</p></div>
      </header>
      <PersonalNote />
      {owner && <Composer onPost={addPost} busy={busy} />}
      {notice && <div className="notice" role="status">{notice}</div>}
      <section className="feed" aria-label="The Wall">
        <div className="feed-heading"><span>the wall</span><span>{loading ? "loading…" : `${visibleEntries.length} ${feedFilter === "issues" ? "issues" : "entries"} loaded`}</span></div>
        <div className="feed-filters" role="group" aria-label="Filter the wall">
          <button type="button" className={feedFilter === "all" ? "selected" : ""} aria-pressed={feedFilter === "all"} onClick={() => setFeedFilter("all")}>All</button>
          <button type="button" className={feedFilter === "issues" ? "selected" : ""} aria-pressed={feedFilter === "issues"} onClick={() => setFeedFilter("issues")}>GitHub issues</button>
        </div>
        {activityUnavailable && <p className="activity-notice" role="status">Some live GitHub activity is unavailable. Recent commits from this build are shown.</p>}
        {!loading && visibleEntries.length === 0 && <div className="empty-wall">{feedFilter === "issues" ? "No GitHub issues in the loaded entries." : "The wall is quiet for now."}</div>}
        {displayEntries.map((entry) => entry.entry_type === "activity-group" ? <ActivityGroup key={entry.id} activities={entry.activities} now={now} /> : entry.entry_type === "activity" ? <ActivityCard key={entry.id} activity={entry} now={now} /> : <PostCard key={entry.id} post={entry} now={now} owner={owner} onDelete={deletePost} onSendFix={sendFix} onRefreshFix={refreshFix} fix={fixes[entry.id]} />)}
        {hasMore && <button className="load-older" type="button" aria-disabled={olderLoading} onClick={() => loadOlder()}>{olderLoading ? "Loading older…" : "Load older"}</button>}
        <span className="feed-status" role="status">{olderLoading ? "Loading entries…" : `${visibleEntries.length} ${feedFilter === "issues" ? "issues" : "entries"} loaded${!hasMore && !loading ? ". All available entries loaded." : "."}`}</span>
      </section>
      <footer className="minimal-footer"><nav><a href="mailto:hello@dericgarza.com">Contact</a></nav><p>Wahl is a small place on purpose.</p></footer>
    </div></main>
  );
}
