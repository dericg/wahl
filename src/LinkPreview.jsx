import { useEffect, useRef, useState } from "react";
import { isCloudConfigured, supabase } from "./supabase";

const requests = new Map();

async function requestPreview(url) {
  if (!isCloudConfigured || !supabase) return null;
  if (!requests.has(url)) requests.set(url, supabase.functions.invoke("link-preview", { body: { url } })
    .then(({ data, error }) => error ? null : data?.preview || null)
    .catch(() => null));
  return requests.get(url);
}

export default function LinkPreview({ link }) {
  const root = useRef(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let active = true;
    const load = () => requestPreview(link.url).then((value) => { if (active && value?.status === "ready") setPreview(value); });
    if (!globalThis.IntersectionObserver) { load(); return () => { active = false; }; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: "500px 0px" });
    if (root.current) observer.observe(root.current);
    return () => { active = false; observer.disconnect(); };
  }, [link.url]);

  let host = "";
  try { host = new URL(link.url).hostname.replace(/^www\./, ""); } catch { host = ""; }
  const title = preview?.title || link.name || link.source || "Shared link";
  const source = preview?.site_name || link.source || host;
  return <a ref={root} className={`memory-link${preview?.image_url ? " has-image" : ""}`} href={link.url} target="_blank" rel="noreferrer">
    {preview?.image_url && <img src={preview.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    <span className="memory-link-copy"><strong>{title}</strong>{preview?.description && <span>{preview.description}</span>}<small>{source}</small></span>
  </a>;
}
