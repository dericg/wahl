import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, Send } from "lucide-react";
import { supabase } from "./supabase";
import { createBriefReview } from "./briefReview.js";
import { BRIEF_LIMIT, briefThought } from "../supabase/functions/_shared/wahl-brief.js";

const previewWelcome = { id: "preview-welcome", role: "assistant", content: "I’m here. We can think through Wahl together, and when the request is clear I can prepare a reviewed change through GitHub.", created_at: new Date().toISOString() };

function Message({ message }) {
  return <li className={`bot-message ${message.role}`}>
    {message.role === "assistant" && <Bot size={14} aria-hidden="true" />}
    <div><strong>{message.role === "assistant" ? "Wahl" : "You"}</strong><p>{message.content}</p></div>
  </li>;
}

export function BriefEditor({ review, previewMode, locked, inputRef, onEdit, onCancel, onConfirm }) {
  const submitting = review.status === "submitting";
  let thought = "";
  try { thought = briefThought(review.brief); } catch { /* Invalid edits cannot be confirmed. */ }
  return <div className="bot-brief bot-form" aria-label="Review the brief">
    <p><strong>{review.brief.mode === "implementation" ? "Implementation" : review.brief.mode === "research" ? "Research" : "Planning"} brief</strong></p>
    <label htmlFor="wahl-bot-brief">Edit the brief</label>
    <textarea ref={inputRef} id="wahl-bot-brief" value={review.brief.text} onChange={(event) => onEdit(event.target.value)} rows={5} disabled={submitting} aria-describedby="wahl-brief-help" />
    <p id="wahl-brief-help">{[...review.brief.text].length} / {BRIEF_LIMIT} characters. {review.brief.mode === "implementation" ? "Confirming creates this private thought and starts the existing issue and pull-request workflow. It does not approve merging or publishing." : "This stays in our conversation. To request code, send an explicit implementation request and prepare a new brief."}</p>
    {thought && <><p>Exact text sent to automation:</p><pre className="bot-brief-text">{thought}</pre></>}
    {previewMode && <p>Local preview uses your messages as a planning draft. The connected bot derives the brief from the conversation.</p>}
    <div><button type="button" onClick={onCancel} disabled={submitting}>Cancel</button>{review.brief.mode === "implementation" && <button type="button" onClick={onConfirm} disabled={!thought || locked || submitting}>{submitting ? "Starting…" : "Confirm and start code work"}</button>}</div>
  </div>;
}

export default function WahlBot({ onRequest, busy, previewMode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(previewMode ? [previewWelcome] : []);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [review, setReview] = useState({ status: "idle", brief: null, error: "" });
  const [chatFailed, setChatFailed] = useState(false);
  const [error, setError] = useState("");
  const loaded = useRef(previewMode);
  const briefInput = useRef(null);
  const prepareButton = useRef(null);
  const focusAfterCancel = useRef(false);
  const request = useRef(onRequest);
  request.current = onRequest;
  const reviewFlow = useRef(null);
  if (!reviewFlow.current) reviewFlow.current = createBriefReview({
    generate: async (history) => previewMode
      ? { mode: "planning", text: `Discuss: ${history.filter((message) => message.role === "user").map((message) => message.content).join("\n")}` }
      : (await invoke({ action: "prepare" })).brief,
    onRequest: (text) => request.current(text),
    onChange: setReview,
  });
  const preparing = review.status === "preparing";
  const submitting = review.status === "submitting";
  const locked = loading || sending || busy || submitting;
  const latestUserMessage = useMemo(() => [...messages].reverse().find((message) => message.role === "user"), [messages]);

  useEffect(() => {
    if (review.status === "review") briefInput.current?.focus();
    if (review.status === "idle" && focusAfterCancel.current) {
      focusAfterCancel.current = false;
      prepareButton.current?.focus();
    }
  }, [review.status]);

  useEffect(() => () => reviewFlow.current.cancel(), []);

  async function invoke(body) {
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData.session?.access_token;
    if (!accessToken) throw new Error("Your session expired. Sign in again.");
    const { data, error: invokeError } = await supabase.functions.invoke("wahl-chat", { body, headers: { Authorization: `Bearer ${accessToken}` } });
    if (invokeError) {
      const context = invokeError.context;
      if (context && typeof context.json === "function") {
        try {
          const response = await context.json();
          if (response?.error) throw new Error(response.error);
        } catch (problem) {
          if (problem instanceof Error && problem.message !== "The Wahl bot could not respond.") throw problem;
        }
      } else if (context && typeof context === "object" && typeof context.error === "string") {
        throw new Error(context.error);
      }
      throw new Error("The Wahl bot could not respond.");
    }
    return data;
  }

  useEffect(() => {
    if (!open || loaded.current || previewMode) return;
    let active = true;
    setLoading(true);
    invoke({ action: "load" }).then((data) => {
      if (active) { setMessages(data.messages || []); loaded.current = true; }
    }).catch((problem) => { if (active) setError(problem.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, previewMode]);

  async function submit(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || locked || preparing) return;
    reviewFlow.current.cancel();
    const localMessage = { id: `local-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() };
    setMessages((current) => [...current, localMessage]);
    setDraft("");
    setSending(true);
    setError("");
    setChatFailed(false);
    if (previewMode) {
      setMessages((current) => [...current, { id: `preview-${Date.now()}`, role: "assistant", content: "On the test site I’ll answer here after reviewing our conversation and Wahl’s repository context. When you’re satisfied, use Prepare this change.", created_at: new Date().toISOString() }]);
      setSending(false);
      return;
    }
    try {
      const data = await invoke({ action: "send", message: content });
      setMessages((current) => [...current, data.message]);
    } catch (problem) {
      setError(problem.message);
      setChatFailed(true);
    } finally {
      setSending(false);
    }
  }

  function prepareChange() {
    if (!latestUserMessage || preparing || locked || draft.trim() || chatFailed) return;
    setError("");
    return reviewFlow.current.prepare(messages);
  }

  function cancelBrief() {
    focusAfterCancel.current = true;
    reviewFlow.current.cancel();
  }

  return <section className={`wahl-bot ${open ? "open" : ""}`} aria-label="Wahl bot">
    <button className="wahl-bot-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="wahl-bot-conversation">
      <span><Bot size={16} /><span><small>Private collaborator</small><strong>Talk with Wahl</strong></span></span><ChevronDown size={17} />
    </button>
    {open && <div id="wahl-bot-conversation" className="wahl-bot-conversation">
      <p className="bot-introduction">Think through an idea with me. I can read Wahl’s current project context, ask questions, and help shape the change before any code work begins.</p>
      {loading && <p className="bot-loading" role="status">Opening our conversation…</p>}
      {!loading && messages.length === 0 && <div className="bot-empty"><Bot size={17} /><p>What are you thinking about?</p></div>}
      {messages.length > 0 && <ol className="bot-history" aria-label="Conversation">{messages.map((message) => <Message key={message.id} message={message} />)}</ol>}
      {sending && <p className="bot-thinking" role="status"><Bot size={13} />Thinking…</p>}
      <form className="bot-form" onSubmit={submit}>
        <label htmlFor="wahl-bot-instruction">Message Wahl</label>
        <textarea id="wahl-bot-instruction" value={draft} onChange={(event) => { setDraft(event.target.value); reviewFlow.current.cancel(); }} maxLength={2000} rows={4} placeholder="Ask a question or describe what you want…" disabled={locked || preparing} />
        <div><span>{draft.length} / 2000 · visible only to you</span><button type="submit" disabled={!draft.trim() || locked || preparing}><Send size={13} />{sending ? "Thinking…" : "Send"}</button></div>
      </form>
      {latestUserMessage && <div className="bot-action"><div><strong>Shape a brief</strong><span>Review a brief from our recent conversation before choosing whether to start code work.</span></div><button ref={prepareButton} type="button" onClick={prepareChange} disabled={preparing || locked || Boolean(draft.trim()) || chatFailed}>{preparing ? "Preparing…" : "Prepare this change"}</button></div>}
      {preparing && <div className="bot-action"><p role="status">Reading our conversation…</p><button type="button" onClick={cancelBrief}>Cancel</button></div>}
      {review.brief && <BriefEditor review={review} previewMode={previewMode} locked={locked || Boolean(draft.trim())} inputRef={briefInput}
        onEdit={(text) => reviewFlow.current.edit(text)} onCancel={cancelBrief}
        onConfirm={() => { if (!locked && !draft.trim()) return reviewFlow.current.confirm(); }} />}
      {review.status === "sent" && <p role="status">Your confirmed request is on the private wall.</p>}
      {review.error && <p className="bot-error" role="alert">{review.error}</p>}
      {error && <p className="bot-error" role="alert">{error}</p>}
    </div>}
  </section>;
}
