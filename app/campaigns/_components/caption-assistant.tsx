"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Image as ImageIcon, Send, Sparkles } from "lucide-react";
import { suggestCaptionAction } from "@/app/campaigns/caption-ai-actions";
import { SHRINK_NOTICE, shrinkPercent } from "@/src/lib/caption-diff";
import type { CaptionChatTurn } from "@/src/lib/caption-ai-types";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  prompt?: string;
  suggestion?: string;
  /** The caption this suggestion was built from, for comparing against it. */
  basis?: string;
  revision?: number;
  state?: "applied" | "dismissed";
  error?: boolean;
};
const STARTERS = ["Make it shorter", "Use a professional tone", "Improve the call to action"];

export function CaptionAssistant({ text, revision, disabled, unavailableReason, images = [], onApply }: {
  text: string;
  revision: number;
  disabled: boolean;
  unavailableReason?: string;
  /** The campaign's pictures, ready to send: asset URLs or data URLs. */
  images?: string[];
  onApply: (suggestion: string, sourceRevision: number) => void;
}) {
  const [prompt, setPrompt] = useState("");
  // Pictures are the advert, so an operator asking for a caption almost always
  // means "about these". They can still untick it.
  const [usePictures, setUsePictures] = useState(true);
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
    if (!question || disabled || unavailableReason || inFlight.current) return;
    inFlight.current = true;
    const id = ++request.current;
    const sourceRevision = revision;
    setMessages((previous) => [...previous, { id: id * 2, role: "user", text: question }]);
    setPrompt("");
    setPending(true);
    composer.current?.focus();
    try {
      // Keep recent conversation bounded; the current draft is sent separately
      // so a previous suggestion is never mistaken for an applied edit.
      const history: CaptionChatTurn[] = [];
      for (const message of messages.slice(-10).reverse()) {
        const content = message.role === "assistant"
          ? JSON.stringify({ message: message.text, suggestion: message.suggestion ?? null, state: message.error ? "rejected" : message.state ?? "proposed" }) : message.text;
        const next = [{ role: message.role, content }, ...history];
        if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 24 * 1024) break;
        history.unshift({ role: message.role, content });
      }
      const sent = usePictures ? images : [];
      const outcome = await suggestCaptionAction({ caption: text, prompt: question, history, ...(sent.length ? { images: sent } : {}) });
      if (request.current !== id) return;
      if (!outcome.ok) throw new Error(outcome.detail);
      const reply = outcome.reply;
      setMessages((previous) => [...previous, { id: id * 2 + 1, role: "assistant", text: reply.message,
        prompt: question, suggestion: reply.suggestion, basis: text, revision: sourceRevision }]);
    } catch (error) {
      if (request.current !== id) return;
      setMessages((previous) => [...previous, { id: id * 2 + 1, role: "assistant", prompt: question, error: true,
        text: error instanceof Error ? error.message : "AI could not prepare a suggestion. Your caption is unchanged; try again." }]);
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
      <span className="pill pill-info">DeepSeek V4.1 Flash</span>
    </div>
    <p className="caption-demo-note">Powered by OpenRouter · Applying a suggestion updates your draft. Nothing changes until you save the caption.</p>
    {images.length ? <label className="caption-pictures-option">
      <input type="checkbox" checked={usePictures} disabled={disabled || Boolean(unavailableReason)}
        onChange={(event) => setUsePictures(event.target.checked)} />
      <ImageIcon size={15} aria-hidden />
      <span>Show the assistant {images.length === 1 ? "this campaign’s picture" : `these ${images.length} campaign pictures`}</span>
    </label> : null}
    {unavailableReason ? <p className="caption-ai-unavailable" role="status">{unavailableReason}</p> : null}
    <div ref={history} className="caption-chat-history" role="log" aria-label="Caption assistant conversation" aria-live="polite" aria-relevant="additions text">
      {messages.length === 0 ? <div className="caption-chat-empty"><Sparkles size={24} aria-hidden />
        <h3>A fresh perspective on your caption</h3>
        <p>Make it more concise, adjust the tone, or give readers a clear next step.</p>
      </div> : null}
      {messages.map((message) => <article className={`caption-message caption-message-${message.role}`} key={message.id}>
        <span className="caption-message-author">{message.role === "user" ? "You" : "Caption assistant"}</span>
        <p className="caption-message-text" role={message.error ? "alert" : undefined}>{message.text}</p>
        {message.error ? <button type="button" className="btn caption-ai-retry" disabled={disabled || pending || Boolean(unavailableReason)} onClick={() => void send(message.prompt!)}>Retry request</button> : null}
        {message.suggestion !== undefined && message.state !== "dismissed" ? <div className="caption-suggestion">
          <span className="caption-preview-eyebrow">Suggested caption</span>
          <pre className="caption-box">{message.suggestion}</pre>
          {shrinkPercent(message.basis ?? "", message.suggestion) >= SHRINK_NOTICE ? <p className="caption-shrink" role="status">
            {shrinkPercent(message.basis ?? "", message.suggestion)}% shorter than your caption
            ({Array.from(message.suggestion).length.toLocaleString()} characters instead of {Array.from(message.basis ?? "").length.toLocaleString()}).
            Check that nothing you need was dropped.
          </p> : null}
          <div className="caption-suggestion-actions">
            {message.state === "applied" ? <span className="caption-applied"><Check size={15} aria-hidden /> Applied to draft</span>
              : message.revision !== revision ? <>
                <span className="card-note">Caption changed. Regenerate to use your latest draft.</span>
                <button type="button" className="btn" disabled={disabled || pending || Boolean(unavailableReason)} onClick={() => void send(message.prompt!)}>Regenerate</button>
              </> : <button type="button" className="btn btn-primary" disabled={disabled || Boolean(unavailableReason)}
                onClick={() => { onApply(message.suggestion!, message.revision!); mark(message.id, "applied"); }}>Apply suggestion</button>}
            {!message.state ? <button type="button" className="btn" disabled={disabled || Boolean(unavailableReason)} onClick={() => mark(message.id, "dismissed")}>Dismiss</button> : null}
          </div>
        </div> : null}
        {message.state === "dismissed" ? <span className="card-note">Suggestion dismissed.</span> : null}
      </article>)}
      {pending ? <p className="caption-chat-pending" role="status"><Sparkles size={15} aria-hidden /> Thinking about your caption…</p> : null}
    </div>
    <div className="caption-chat-bottom">
      <div className="caption-starter-prompts" aria-label="Suggested requests">{STARTERS.map((starter) =>
        <button type="button" className="caption-starter" key={starter} disabled={disabled || pending || Boolean(unavailableReason)}
          onClick={() => void send(starter)}>{starter}</button>)}</div>
      <form className="caption-composer" onSubmit={(event) => { event.preventDefault(); void send(prompt); }} aria-label="Ask the caption assistant">
        <label className="sr-only" htmlFor="caption-ai-prompt">Message the caption assistant</label>
        <textarea id="caption-ai-prompt" ref={composer} rows={2} maxLength={4000} value={prompt} disabled={disabled || Boolean(unavailableReason)}
          placeholder="Ask AI to refine your caption…" onChange={(event) => setPrompt(event.target.value)}
          aria-describedby="caption-chat-keyboard"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); void send(prompt);
            }
          }} />
        <button type="submit" className="btn btn-primary caption-send" aria-label="Send message" disabled={disabled || pending || Boolean(unavailableReason) || !prompt.trim() || prompt.length > 4000}>
          <Send size={17} aria-hidden /><span>Send</span>
        </button>
      </form>
      <p className="card-note" id="caption-chat-keyboard">Enter to send · Shift + Enter for a new line</p>
    </div>
  </section>;
}
