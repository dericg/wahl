import { useEffect, useState } from "react";
import { ChevronDown, Globe2, Lock, LogIn, LogOut, Trash2 } from "lucide-react";
import { INITIAL_POSTS } from "./data";
import { isCloudConfigured, supabase } from "./supabase";

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

function Composer({ onPost, busy }) {
  const [draft, setDraft] = useState("");
  const [audience, setAudience] = useState("everyone");

  async function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    const saved = await onPost({ text, audience });
    if (saved) setDraft("");
  }

  return (
    <section className="composer" aria-label="Create a post">
      <label htmlFor="thought">what’s the thought?</label>
      <textarea id="thought" value={draft} maxLength={320} rows={3} onChange={(event) => setDraft(event.target.value)} placeholder="Type it before it disappears…" />
      <div className="audience-row" aria-label="Choose who can see this">
        <button className={`audience-pill ${audience === "private" ? "selected" : ""}`} onClick={() => setAudience("private")} type="button" aria-pressed={audience === "private"}><Lock size={13} />Only me</button>
        <button className={`audience-pill ${audience === "everyone" ? "selected" : ""}`} onClick={() => setAudience("everyone")} type="button" aria-pressed={audience === "everyone"}><Globe2 size={13} />Everyone</button>
      </div>
      <div className="composer-footer"><span>{draft.length ? `${draft.length} / 320` : audience === "private" ? "a private draft, visible only to you" : "published to your public wall"}</span><button className="post-button" type="button" disabled={!draft.trim() || busy} onClick={submit}>{busy ? "Posting…" : "Post"}</button></div>
    </section>
  );
}

function PostCard({ post, owner, onDelete }) {
  const privatePost = post.audience_type === "private";
  const Icon = privatePost ? Lock : Globe2;
  return (
    <article className="post-card">
      <header className="post-header">
        <div><strong className="mine">Deric</strong><time dateTime={new Date(post.created_at).toISOString()}>{timeAgo(post.created_at)}</time></div>
        <div className="post-tools"><span className="audience-badge"><Icon size={12} />{privatePost ? "Only me" : "Everyone"}</span>{owner && <button className="delete-post" type="button" onClick={() => onDelete(post.id)} aria-label="Delete this post"><Trash2 size={13} /></button>}</div>
      </header>
      <p>{post.text}</p>
    </article>
  );
}

function SignIn({ session, owner }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  async function sendLink(event) {
    event.preventDefault();
    setMessage("Sending…");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    setMessage(error ? error.message : "Check your email for the sign-in link.");
  }

  if (!isCloudConfigured) return <span>{previewMode ? "Local preview" : "Read-only"}</span>;
  if (session) return <button className="quiet-button" type="button" onClick={() => supabase.auth.signOut()}><LogOut size={12} />{owner ? "Sign out" : "Not authorized · sign out"}</button>;
  if (!open) return <button className="quiet-button" type="button" onClick={() => setOpen(true)}><LogIn size={12} />Owner sign in</button>;
  return <form className="sign-in" onSubmit={sendLink}><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" aria-label="Email address" /><button type="submit">Send link</button>{message && <small>{message}</small>}</form>;
}

export default function App() {
  const [posts, setPosts] = useState(() => previewMode ? INITIAL_POSTS.map((post) => ({ ...post, audience_type: post.audience === "private" ? "private" : "everyone", created_at: new Date(post.createdAt).toISOString() })) : []);
  const [session, setSession] = useState(null);
  const [owner, setOwner] = useState(previewMode);
  const [loading, setLoading] = useState(isCloudConfigured);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function loadWall() {
    if (!supabase) return;
    setLoading(true);
    const [{ data, error }, { data: isOwner }] = await Promise.all([
      supabase.from("posts").select("id,text,audience_type,created_at").order("created_at", { ascending: false }),
      supabase.rpc("is_wahl_owner"),
    ]);
    setOwner(Boolean(isOwner));
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

  return (
    <main><div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="shell">
      <header className="brand"><div className="brand-line"><div className="wordmark">Wahl<span>.</span></div><span>by Deric Garza</span></div><p>thoughts, small observations, and things worth keeping</p></header>
      <PersonalNote />
      {owner && <Composer onPost={addPost} busy={busy} />}
      {notice && <div className="notice" role="status">{notice}</div>}
      <section className="feed" aria-label="The Wall"><div className="feed-heading"><span>the wall</span><span>{loading ? "loading…" : `${posts.length} thoughts`}</span></div>{!loading && posts.length === 0 && <div className="empty-wall">The wall is quiet for now.</div>}{posts.map((post) => <PostCard key={post.id} post={post} owner={owner} onDelete={deletePost} />)}</section>
      <footer className="minimal-footer"><nav><a href="mailto:hello@dericgarza.com">Contact</a></nav><p>Wahl is a small place on purpose.</p><div className="owner-access"><SignIn session={session} owner={owner} /></div></footer>
    </div></main>
  );
}
