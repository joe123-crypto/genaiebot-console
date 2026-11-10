"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Send, Sparkles } from "lucide-react";
import { demoCaptionReply } from "@/src/lib/caption-ai-demo";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  prompt?: string;
  suggestion?: string;
  revision?: number;
  state?: "applied" | "dismissed";
};
const STARTERS = ["Make it shorter", "Use a professional tone", "Improve the call to action"];

export function CaptionAssistant({ text, revision, disabled, onApply }: {
  text: string;
  revision: number;
  disabled: boolean;
  onApply: (suggestion: string, sourceRevision: number) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  const inFlight = useRef(false);
  const history = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => {
    const container = history.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, pending]);

  async function send(value: string) {
    const question = value.trim();
    if (!question || disabled || inFlight.current) return;
    inFlight.current = true;
    const id = ++request.current;
    const sourceRevision = revision;
    setMessages((previous) => [...previous, { id: id * 2, role: "user", text: question }]);
    setPrompt("");
    setPending(true);
    composer.current?.focus();
    try {
      const reply = await demoCaptionReply(question, text);
      if (request.current !== id) return;
      setMessages((previous) => [...previous, { id: id * 2 + 1, role: "assistant", text: reply.message,
        prompt: question, suggestion: reply.suggestion, revision: sourceRevision }]);
    } catch {
      if (request.current !== id) return;
      setMessages((previous) => [...previous, { id: id * 2 + 1, role: "assistant",
        text: "The demo could not prepare a suggestion. Try sending your request again." }]);
    } finally {
      if (request.current === id) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }

  function mark(id: number, state: "applied" | "dismissed") {
    setMessages((previous) => previous.map((message) => message.id === id ? { ...message, state } : message));
  }

  return <section className="card caption-assistant" aria-labelledby="caption-assistant-title">
    <div className="card-head">
      <div className="caption-assistant-heading">
        <span className="caption-ai-icon"><Sparkles size={20} aria-hidden /></span>
        <div><h2 className="card-title" id="caption-assistant-title">Your caption assistant</h2>
          <p className="card-note caption-help">Describe what you’d like to change. Review a suggestion before applying it.</p></div>
      </div>
      <span className="pill pill-info">AI demo</span>
    </div>
    <p className="caption-demo-note">Simulated suggestions · No AI service is connected. Applying a suggestion updates your draft; Save caption publishes it.</p>
    <div ref={history} className="caption-chat-history" role="log" aria-label="Caption assistant conversation" aria-live="polite" aria-relevant="additions text">
      {messages.length === 0 ? <div className="caption-chat-empty"><Sparkles size={24} aria-hidden />
        <h3>A fresh perspective on your caption</h3>
        <p>Make it more concise, adjust the tone, or give readers a clear next step.</p>
      </div> : null}
      {messages.map((message) => <article className={`caption-message caption-message-${message.role}`} key={message.id}>
        <span className="caption-message-author">{message.role === "user" ? "You" : "Caption assistant · Demo"}</span>
        <p className="caption-message-text">{message.text}</p>
        {message.suggestion !== undefined && message.state !== "dismissed" ? <div className="caption-suggestion">
          <span className="caption-preview-eyebrow">Suggested caption</span>
          <pre className="caption-box">{message.suggestion}</pre>
          <div className="caption-suggestion-actions">
            {message.state === "applied" ? <span className="caption-applied"><Check size={15} aria-hidden /> Applied to draft</span>
              : message.revision !== revision ? <>
                <span className="card-note">Caption changed. Regenerate to use your latest draft.</span>
                <button type="button" className="btn" disabled={disabled || pending} onClick={() => void send(message.prompt!)}>Regenerate</button>
              </> : <button type="button" className="btn btn-primary" disabled={disabled}
                onClick={() => { onApply(message.suggestion!, message.revision!); mark(message.id, "applied"); }}>Apply suggestion</button>}
            {!message.state ? <button type="button" className="btn" disabled={disabled} onClick={() => mark(message.id, "dismissed")}>Dismiss</button> : null}
          </div>
        </div> : null}
        {message.state === "dismissed" ? <span className="card-note">Suggestion dismissed.</span> : null}
      </article>)}
      {pending ? <p className="caption-chat-pending" role="status"><Sparkles size={15} aria-hidden /> Preparing a demo suggestion…</p> : null}
    </div>
    <div className="caption-chat-bottom">
      <div className="caption-starter-prompts" aria-label="Suggested requests">{STARTERS.map((starter) =>
        <button type="button" className="caption-starter" key={starter} disabled={disabled || pending}
          onClick={() => void send(starter)}>{starter}</button>)}</div>
      <form className="caption-composer" onSubmit={(event) => { event.preventDefault(); void send(prompt); }} aria-label="Ask the caption assistant">
        <label className="sr-only" htmlFor="caption-ai-prompt">Message the caption assistant</label>
        <textarea id="caption-ai-prompt" ref={composer} rows={2} value={prompt} disabled={disabled}
          placeholder="Ask AI to refine your caption…" onChange={(event) => setPrompt(event.target.value)}
          aria-describedby="caption-chat-keyboard"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); void send(prompt);
            }
          }} />
        <button type="submit" className="btn btn-primary caption-send" aria-label="Send message" disabled={disabled || pending || !prompt.trim()}>
          <Send size={17} aria-hidden /><span>Send</span>
        </button>
      </form>
      <p className="card-note" id="caption-chat-keyboard">Enter to send · Shift + Enter for a new line</p>
    </div>
  </section>;
}
