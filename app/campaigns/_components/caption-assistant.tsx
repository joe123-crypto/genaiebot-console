"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Image as ImageIcon, Link2, Send, Sparkles } from "lucide-react";
import { captionLinkAccountsAction, suggestCaptionAction } from "@/app/campaigns/caption-ai-actions";
import { SHRINK_NOTICE, shrinkPercent } from "@/src/lib/caption-diff";
import { internationalNumber, proposeTrackedLink, whatsappLinks } from "@/src/lib/tracked-caption-link";
import type { LineAccount, Tracking } from "@/src/lib/types";
import type { CaptionChatTurn } from "@/src/lib/caption-ai-types";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  prompt?: string;
  suggestion?: string;
  tracking?: Tracking;
  trackedLinkRequested?: boolean;
  /** The caption this suggestion was built from, for comparing against it. */
  basis?: string;
  revision?: number;
  state?: "applied" | "dismissed";
  error?: boolean;
};
const STARTERS = ["Make it shorter", "Use a professional tone", "Improve the call to action"];

export function CaptionAssistant({ text, revision, disabled, unavailableReason, images = [], linkContext, onApply }: {
  text: string;
  revision: number;
  disabled: boolean;
  unavailableReason?: string;
  /** The campaign's pictures, ready to send: asset URLs or data URLs. */
  images?: string[];
  linkContext?: { slug: string; name: string; tracking: Tracking; unavailableReason?: string };
  onApply: (suggestion: string, sourceRevision: number, tracking?: Tracking) => void;
}) {
  const [prompt, setPrompt] = useState("");
  // Pictures are the advert, so an operator asking for a caption almost always
  // means "about these". They can still untick it.
  const [usePictures, setUsePictures] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [linkFlow, setLinkFlow] = useState<{ number: string; replace: string; basis: string; revision: number } | null>(null);
  const [accounts, setAccounts] = useState<LineAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [linkError, setLinkError] = useState("");
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

  function startLink(number = "", basis = text, sourceRevision = revision) {
    if (!linkContext || disabled || linkContext.unavailableReason) return;
    setLinkError("");
    setLinkFlow({ number: number || linkContext.tracking.number || "", replace: "", basis, revision: sourceRevision });
    setAccountsLoading(true);
    void captionLinkAccountsAction().then(setAccounts).catch(() => setAccounts([])).finally(() => setAccountsLoading(false));
  }

  function prepareLink() {
    if (!linkFlow || !linkContext || linkContext.unavailableReason || disabled || pending || linkFlow.revision !== revision) return;
    if (!internationalNumber(linkFlow.number)) { setLinkError("Enter an international WhatsApp number, including its country code."); return; }
    if (whatsappLinks(linkFlow.basis).length && !linkFlow.replace) { setLinkError("Choose which existing link to replace, or append a new link."); return; }
    const proposed = proposeTrackedLink(linkFlow.basis, linkFlow.number, linkContext.slug, linkContext.name, linkContext.tracking,
      linkFlow.replace === "append" ? undefined : linkFlow.replace || undefined);
    const id = ++request.current;
    setMessages((previous) => [...previous, { id: id * 2 + 1, role: "assistant", text: "Review your tracked WhatsApp link.",
      prompt: "Add tracked WhatsApp link", suggestion: proposed.caption, tracking: proposed.tracking, basis: linkFlow.basis, revision: linkFlow.revision }]);
    setLinkFlow(null);
  }

  async function send(value: string) {
    const question = value.trim();
    if (!question || disabled || unavailableReason || inFlight.current) return;
    if (linkFlow && internationalNumber(question)) {
      setLinkFlow({ ...linkFlow, number: question }); setPrompt(""); setLinkError(""); return;
    }
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
          ? JSON.stringify({ message: message.text, suggestion: message.suggestion ?? null, trackedLinkRequested: message.trackedLinkRequested, destinationNumber: message.tracking?.number, state: message.error ? "rejected" : message.state ?? "proposed" }) : message.text;
        const next = [{ role: message.role, content }, ...history];
        if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 24 * 1024) break;
        history.unshift({ role: message.role, content });
      }
      const sent = usePictures ? images : [];
      const outcome = await suggestCaptionAction({ caption: text, prompt: linkFlow ? `For the tracked WhatsApp link destination: ${question}` : question, history, ...(sent.length ? { images: sent } : {}) });
      if (request.current !== id) return;
      if (!outcome.ok) throw new Error(outcome.detail);
      const reply = outcome.reply;
      setMessages((previous) => [...previous, { id: id * 2 + 1, role: "assistant", text: reply.message,
        prompt: question, suggestion: reply.suggestion, trackedLinkRequested: Boolean(reply.trackedLink), basis: text, revision: sourceRevision }]);
      if (reply.trackedLink) startLink(reply.trackedLink.number, text, sourceRevision);
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

  // Three stacked bands of small print used to sit between the heading and
  // the first message. The heading is now a name and the model it runs on;
  // how it works is said once, where the conversation starts, and whether
  // to send the pictures is a setting for the message being written, so it
  // sits with the composer.
  return <section className="card caption-assistant" aria-labelledby="caption-assistant-title">
    <div className="card-head section-head caption-assistant-head">
      <div className="caption-assistant-heading">
        <span className="caption-ai-icon"><Sparkles size={17} aria-hidden /></span>
        <h2 className="card-title" id="caption-assistant-title">Caption assistant</h2>
      </div>
      <span className="pill pill-info section-actions">DeepSeek V4.1 Flash</span>
    </div>
    {unavailableReason ? <p className="caption-ai-unavailable" role="status">{unavailableReason}</p> : null}
    <div ref={history} className="caption-chat-history" role="log" aria-label="Caption assistant conversation" aria-live="polite" aria-relevant="additions text">
      {messages.length === 0 ? <div className="caption-chat-empty"><Sparkles size={24} aria-hidden />
        <h3>A fresh perspective on your caption</h3>
        <p>Ask for a change and review the suggestion before it touches your draft. Nothing is saved until you save the caption.</p>
      </div> : null}
      {messages.map((message) => <article className={`caption-message caption-message-${message.role}`} key={message.id}>
        <span className="caption-message-author">{message.role === "user" ? "You" : "Caption assistant"}</span>
        <p className="caption-message-text" role={message.error ? "alert" : undefined}>{message.text}</p>
        {message.error ? <button type="button" className="btn caption-ai-retry" disabled={disabled || pending || Boolean(unavailableReason)} onClick={() => void send(message.prompt!)}>Retry request</button> : null}
        {message.suggestion !== undefined && message.state !== "dismissed" ? <div className="caption-suggestion">
          <span className="caption-preview-eyebrow">Suggested caption</span>
          {message.tracking ? <p className="card-note">Destination: <strong>{message.tracking.number}</strong>. This fixed number applies to every caption variant in this campaign.</p> : null}
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
                <button type="button" className="btn" disabled={disabled || pending || (message.tracking ? Boolean(linkContext?.unavailableReason) : Boolean(unavailableReason))} onClick={() => message.tracking ? startLink(message.tracking.number) : void send(message.prompt!)}>Regenerate</button>
              </> : <button type="button" className="btn btn-primary" disabled={disabled || (message.tracking ? Boolean(linkContext?.unavailableReason) : Boolean(unavailableReason))}
                onClick={() => { onApply(message.suggestion!, message.revision!, message.tracking); mark(message.id, "applied"); }}>Apply suggestion</button>}
            {!message.state ? <button type="button" className="btn" disabled={disabled || Boolean(unavailableReason)} onClick={() => mark(message.id, "dismissed")}>Dismiss</button> : null}
          </div>
        </div> : null}
        {message.state === "dismissed" ? <span className="card-note">Suggestion dismissed.</span> : null}
      </article>)}
      {pending ? <p className="caption-chat-pending" role="status"><Sparkles size={15} aria-hidden /> Thinking about your caption…</p> : null}
    </div>
    <div className="caption-chat-bottom">
      {linkFlow ? <form className="tracked-link-form" aria-label="Tracked WhatsApp link" onSubmit={(event) => { event.preventDefault(); prepareLink(); }}>
        <p>Which WhatsApp number should the link open? One fixed number applies to every variant in this campaign.</p>
        {accountsLoading ? <p className="card-note" role="status">Loading bot numbers…</p> : accounts.length ? <div>
          <label className="modal-label" htmlFor="tracked-link-bot">Choose a bot number</label>
          <select className="modal-input" id="tracked-link-bot" disabled={disabled || pending} value={accounts.some((account) => account.number === linkFlow.number) ? linkFlow.number : ""}
            onChange={(event) => setLinkFlow({ ...linkFlow, number: event.target.value })}>
            <option value="">Enter a number below</option>
            {accounts.map((account) => <option key={account.id} value={account.number}>{account.id} · {account.number}</option>)}
          </select></div> : <p className="card-note">Enter a destination number, including the country code. You can use the bot’s own number.</p>}
        <label className="modal-label" htmlFor="tracked-link-number">Destination WhatsApp number</label>
        <input className="modal-input" type="tel" id="tracked-link-number" autoComplete="tel" value={linkFlow.number} disabled={disabled || pending}
          placeholder="+263…" onChange={(event) => { setLinkFlow({ ...linkFlow, number: event.target.value }); setLinkError(""); }} />
        {whatsappLinks(linkFlow.basis).length ? <div>
          <label className="modal-label" htmlFor="tracked-link-replace">Existing WhatsApp links</label>
          <select className="modal-input" id="tracked-link-replace" value={linkFlow.replace} disabled={disabled || pending}
            onChange={(event) => setLinkFlow({ ...linkFlow, replace: event.target.value })}>
            <option value="">Choose a link to replace or append</option>
            {whatsappLinks(linkFlow.basis).map((link) => <option key={link} value={link}>Replace {link}</option>)}
            <option value="append">Keep existing links and append</option>
          </select></div> : null}
        {linkError ? <p className="caption-error" role="alert">{linkError}</p> : null}
        {linkFlow.revision !== revision ? <p className="card-note" role="status">Caption changed. Choose Add tracked WhatsApp link again to use the latest draft.</p> : null}
        <div className="caption-suggestion-actions">
          <button type="submit" className="btn btn-primary" disabled={disabled || pending || linkFlow.revision !== revision}>Preview tracked link</button>
          <button type="button" className="btn" onClick={() => setLinkFlow(null)}>Cancel link</button>
        </div>
      </form> : null}
      <div className="caption-starter-prompts" aria-label="Suggested requests">{STARTERS.map((starter) =>
        <button type="button" className="caption-starter" key={starter} disabled={disabled || pending || Boolean(unavailableReason)}
          onClick={() => void send(starter)}>{starter}</button>)}
        {linkContext ? <button type="button" className="caption-starter caption-starter-link" disabled={disabled || pending || Boolean(linkContext.unavailableReason)}
          title={linkContext.unavailableReason} onClick={() => startLink()}><Link2 size={13} aria-hidden /> Add tracked WhatsApp link</button> : null}
      </div>
      {linkContext?.unavailableReason ? <p className="card-note caption-link-unavailable">{linkContext.unavailableReason}</p> : null}
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
      <div className="caption-chat-meta">
        {images.length ? <label className="caption-pictures-option">
          <input type="checkbox" checked={usePictures} disabled={disabled || Boolean(unavailableReason)}
            onChange={(event) => setUsePictures(event.target.checked)} />
          <ImageIcon size={14} aria-hidden />
          <span>Show the assistant {images.length === 1 ? "this campaign’s picture" : `these ${images.length} campaign pictures`}</span>
        </label> : null}
        <p className="card-note" id="caption-chat-keyboard">Enter to send · Shift + Enter for a new line · via OpenRouter</p>
      </div>
    </div>
  </section>;
}
