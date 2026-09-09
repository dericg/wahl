import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, Send } from "lucide-react";
import { supabase } from "./supabase";

const previewWelcome = { id: "preview-welcome", role: "assistant", content: "I’m here. We can think through Wahl together, and when the request is clear I can prepare a reviewed change through GitHub.", created_at: new Date().toISOString() };

function Message({ message }) {
  return <li className={`bot-message ${message.role}`}>
    {message.role === "assistant" && <Bot size={14} aria-hidden="true" />}
    <div><strong>{message.role === "assistant" ? "Wahl" : "You"}</strong><p>{message.content}</p></div>
  </li>;
}

export default function WahlBot({ onRequest, busy, previewMode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(previewMode ? [previewWelcome] : []);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const loaded = useRef(previewMode);
  const latestUserMessage = useMemo(() => [...messages].reverse().find((message) => message.role === "user"), [messages]);

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
    if (!content || sending || busy) return;
    const localMessage = { id: `local-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() };
    setMessages((current) => [...current, localMessage]);
    setDraft("");
    setSending(true);
    setError("");
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
    } finally {
      setSending(false);
    }
  }

  async function prepareChange() {
    if (!latestUserMessage || preparing || busy) return;
    setPreparing(true);
    setError("");
    const accepted = await onRequest(latestUserMessage.content.slice(0, 300));
    if (!accepted) setError("The change request could not be prepared. No GitHub work was started.");
    setPreparing(false);
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
        <textarea id="wahl-bot-instruction" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={4} placeholder="Ask a question or describe what you want…" disabled={sending || busy} />
        <div><span>{draft.length} / 2000 · visible only to you</span><button type="submit" disabled={!draft.trim() || sending || busy}><Send size={13} />{sending ? "Thinking…" : "Send"}</button></div>
      </form>
      {latestUserMessage && <div className="bot-action"><div><strong>Ready for code?</strong><span>This sends your latest instruction through the existing issue and pull-request review process.</span></div><button type="button" onClick={prepareChange} disabled={preparing || busy || sending}>{preparing ? "Preparing…" : "Prepare this change"}</button></div>}
      {error && <p className="bot-error" role="alert">{error}</p>}
    </div>}
  </section>;
}
