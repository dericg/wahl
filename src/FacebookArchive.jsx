import { Fragment, useEffect, useMemo, useState } from "react";
import { CalendarDays, FolderOpen, Image as ImageIcon, Search } from "lucide-react";
import { filterArchive, memoriesOnThisDay, readFacebookArchive } from "./facebookArchive.js";
import { exactTime } from "./time";
import LinkPreview from "./LinkPreview";

const PAGE_SIZE = 40;

function MemoryMedia({ media }) {
  const file = media?.file;
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) { setUrl(""); return undefined; }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  if (!url) return null;
  if (/\.(?:mp4|mov)$/i.test(media.path)) return <video className="memory-media" src={url} controls preload="metadata" />;
  return <img className="memory-media" src={url} alt="Media saved with this Facebook memory" loading="lazy" />;
}

export function MemoryCard({ entry, compact = false }) {
  const genericLinkTitle = /shared a link\.?$/i.test(entry.text);
  return <article className={`post-card memory-card${compact ? " compact" : ""}`}>
    <header className="post-header">
      <time dateTime={entry.occurredAt}>{exactTime(entry.occurredAt)}</time>
      <span className="activity-kind">{entry.kind}</span>
    </header>
    {entry.media[0] && <MemoryMedia media={entry.media[0]} />}
    {entry.text && (!genericLinkTitle || !entry.link) && <p>{entry.text}</p>}
    {entry.link && <LinkPreview link={entry.link} />}
    {entry.place && <small className="memory-place">{entry.place}</small>}
    {entry.media.length > 1 && <small className="memory-count"><ImageIcon size={12} />{entry.media.length} items in the original entry</small>}
  </article>;
}

export function OnThisDay({ entries }) {
  const memories = useMemo(() => memoriesOnThisDay(entries), [entries]);
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(6);
  if (!memories.length) return null;
  const years = new Set(memories.map((entry) => entry.year)).size;
  const today = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date());
  return <section className="archive-today">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span><CalendarDays size={16} />On this day</span><small>{memories.length} {memories.length === 1 ? "memory" : "memories"} from {today}</small>
    </button>
    {open && <div className="archive-today-content">
      <p>Looking back across {years} {years === 1 ? "year" : "years"}</p>
      <div className="archive-today-grid">{memories.slice(0, shown).map((entry) => <MemoryCard key={entry.id} entry={entry} compact />)}</div>
      {shown < memories.length && <button className="load-older" type="button" onClick={() => setShown((value) => value + 6)}>Show more from this day</button>}
    </div>}
  </section>;
}

export default function FacebookArchive({ entries, setEntries }) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("all");
  const [kind, setKind] = useState("all");
  const [scope, setScope] = useState("useful");
  const [shown, setShown] = useState(PAGE_SIZE);
  const years = useMemo(() => [...new Set(entries.map((entry) => entry.year))].sort((a, b) => b - a), [entries]);
  const filtered = useMemo(() => filterArchive(entries, { query, year, kind, scope }), [entries, query, year, kind, scope]);

  async function chooseArchive(event) {
    const files = event.target.files;
    if (!files?.length) return;
    setError("");
    setStatus("Reading your archive…");
    try {
      const imported = await readFacebookArchive(files, ({ current, total }) => setStatus(`Reading archive files ${current} of ${total}…`));
      setEntries(imported);
      setShown(PAGE_SIZE);
      setStatus(imported.length ? `${imported.length.toLocaleString()} memories ready on this device.` : "No supported posts or stories were found.");
    } catch {
      setEntries([]);
      setError("Wahl couldn’t read this export. Choose the “your_facebook_activity” folder from an unzipped Facebook download.");
      setStatus("");
    } finally {
      event.target.value = "";
    }
  }

  if (!entries.length) return <div className="archive-empty">
    <FolderOpen size={24} />
    <h2>Open your Facebook archive</h2>
    <p>Choose the <strong>your_facebook_activity</strong> folder. Wahl reads posts, stories, and their media on this device. Nothing is uploaded or saved to the site.</p>
    <label className="archive-picker"><FolderOpen size={14} />Choose archive folder<input type="file" webkitdirectory="" directory="" multiple onChange={chooseArchive} /></label>
    {status && <small role="status">{status}</small>}{error && <small className="archive-error" role="alert">{error}</small>}
  </div>;

  return <div className="archive-browser">
    <div className="archive-toolbar">
      <div className="archive-summary"><span>{entries.length.toLocaleString()} private memories</span><label className="archive-picker quiet"><FolderOpen size={13} />Choose another folder<input type="file" webkitdirectory="" directory="" multiple onChange={chooseArchive} /></label></div>
      <div className="archive-controls">
        <label className="archive-search"><Search size={14} /><span className="visually-hidden">Search archive</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setShown(PAGE_SIZE); }} placeholder="Search your archive" /></label>
        <select aria-label="Filter archive by year" value={year} onChange={(event) => { setYear(event.target.value); setShown(PAGE_SIZE); }}><option value="all">All years</option>{years.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label="Filter archive by type" value={kind} onChange={(event) => { setKind(event.target.value); setShown(PAGE_SIZE); }}><option value="all">All types</option><option value="post">Posts</option><option value="photo">Photos</option><option value="video">Videos</option><option value="story">Stories</option><option value="check-in">Check-ins</option></select>
        <select aria-label="Choose archive detail" value={scope} onChange={(event) => { setScope(event.target.value); setShown(PAGE_SIZE); }}><option value="useful">With content</option><option value="all">Everything</option></select>
      </div>
      <p className="archive-results">{filtered.length.toLocaleString()} {scope === "useful" ? "memories worth opening" : "export records"}</p>
    </div>
    <OnThisDay entries={entries} />
    {filtered.length ? <div className="archive-grid">{filtered.slice(0, shown).map((entry, index, visible) => <Fragment key={entry.id}>{(index === 0 || visible[index - 1].year !== entry.year) && <h2 className="archive-year">{entry.year}</h2>}<MemoryCard entry={entry} /></Fragment>)}</div> : <div className="empty-wall">No memories match these filters.</div>}
    {shown < filtered.length && <button className="load-older" type="button" onClick={() => setShown((value) => value + PAGE_SIZE)}>Show more memories</button>}
    {status && <span className="feed-status" role="status">{status}</span>}
  </div>;
}
