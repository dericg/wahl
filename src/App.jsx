import { useEffect, useState } from "react";
import { ChevronDown, Globe2, Lock, LogIn, LogOut, Trash2 } from "lucide-react";
import { INITIAL_POSTS } from "./data";
import { isCloudConfigured, supabase } from "./supabase";
import ThoughtEditor from "./ThoughtEditor";
import { draftDetails, FormattedText } from "./formattedText";

const previewMode = import.meta.env.DEV && !isCloudConfigured;

function timeAgo(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 15) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
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

function PostCard({ post, owner, onDelete, onSendFix, fix }) {
  const privatePost = post.audience_type === "private";
  const fixRequest = owner && privatePost && /#fix\b/i.test(post.text);
  const Icon = privatePost ? Lock : Globe2;
  const fixStatus = fix?.status === "pr_ready" ? "Pull request ready" : fix?.status === "working" ? "Codex is working" : fix?.status === "failed" ? "Needs attention" : fix ? "Sent to Codex" : "Site improvement";
  return (
    <article className="post-card">
      <header className="post-header">
        <div><strong className="mine">Deric</strong><time dateTime={new Date(post.created_at).toISOString()}>{timeAgo(post.created_at)}</time></div>
        <div className="post-tools"><span className="audience-badge"><Icon size={12} />{privatePost ? "Only me" : "Everyone"}</span>{owner && <button className="delete-post" type="button" onClick={() => onDelete(post.id)} aria-label="Delete this post"><Trash2 size={13} /></button>}</div>
      </header>
      <p><FormattedText text={post.text} /></p>
      {fixRequest && <div className="fix-request"><span>{fixStatus}</span>{fix?.pull_request_url ? <a href={fix.pull_request_url} target="_blank" rel="noreferrer">Review pull request</a> : fix ? <a href="https://github.com/dericg/wahl/actions/workflows/wahl-fix.yml" target="_blank" rel="noreferrer">View progress</a> : <button type="button" onClick={() => onSendFix(post.id)}>Send to Codex</button>}</div>}
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

  async function loadWall() {
    if (!supabase) return;
    setLoading(true);
    const [{ data, error }, { data: isOwner }, { data: fixData }] = await Promise.all([
      supabase.from("posts").select("id,text,audience_type,created_at").order("created_at", { ascending: false }),
      supabase.rpc("is_wahl_owner"),
      supabase.from("automation_requests").select("id,post_id,status,pull_request_url,updated_at"),
    ]);
    setOwner(Boolean(isOwner));
    setFixes(Object.fromEntries((fixData || []).map((fix) => [fix.post_id, fix])));
    if (error) setNotice("The wall couldn’t be loaded. Please try again shortly.");
    else { setPosts(data || []); setNotice(""); }
    setLoading(false);
  }

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    loadWall();
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); window.setTimeout(loadWall, 0); });
    return () => data.subscription.unsubscribe();
  }, []);

  async function addPost({ text, audience }) {
    if (previewMode) {
      setPosts((current) => [{ id: crypto.randomUUID(), text, audience_type: audience, created_at: new Date().toISOString() }, ...current]);
      return true;
    }
    if (!supabase || !session || !owner) return false;
    setBusy(true);
    const { data, error } = await supabase.from("posts").insert({ author_id: session.user.id, text, audience_type: audience }).select("id,text,audience_type,created_at").single();
    setBusy(false);
    if (error) { setNotice(error.message); return false; }
    setPosts((current) => [data, ...current]);
    return true;
  }

  async function deletePost(id) {
    if (previewMode) { setPosts((current) => current.filter((post) => post.id !== id)); return; }
    const { error } = await supabase.from("posts").delete().eq("id", id);
    if (error) setNotice(error.message); else setPosts((current) => current.filter((post) => post.id !== id));
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

  return (
    <main><div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="shell">
      <header className="brand"><div className="brand-line"><div className="wordmark">Wahl<span>.</span></div><span>by Deric Garza</span></div><p>thoughts, small observations, and things worth keeping</p></header>
      <PersonalNote />
      {owner && <Composer onPost={addPost} busy={busy} />}
      {notice && <div className="notice" role="status">{notice}</div>}
      <section className="feed" aria-label="The Wall"><div className="feed-heading"><span>the wall</span><span>{loading ? "loading…" : `${posts.length} thoughts`}</span></div>{!loading && posts.length === 0 && <div className="empty-wall">The wall is quiet for now.</div>}{posts.map((post) => <PostCard key={post.id} post={post} owner={owner} onDelete={deletePost} onSendFix={sendFix} fix={fixes[post.id]} />)}</section>
      <footer className="minimal-footer"><nav><a href="mailto:hello@dericgarza.com">Contact</a></nav><p>Wahl is a small place on purpose.</p><ReleaseHistory /><div className="owner-access"><SignIn session={session} owner={owner} /></div></footer>
    </div></main>
  );
}
