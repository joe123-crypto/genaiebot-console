"use client";

import { useEffect, useRef, useState } from "react";
import { useDisplayTimezone } from "@/app/_components/timezone-context";
import Link from "next/link";
import { Database } from "lucide-react";
import { PageHead, Section } from "@/app/_components/ui";
import { checkCustomerBotAction, publishCustomerBotAction } from "../actions";
import { ReplyModeCard, replyModePill } from "./reply-mode-card";
import {
  CUSTOMER_BOT_FIELDS, CUSTOMER_BOT_LABELS, customerBotProblem, customerBotText, isCustomerBotText,
  isCustomerBotVersion, sameCustomerBotText, type CustomerBotText, type CustomerBotVersion,
} from "@/src/lib/customer-bot-types";

type Draft = { base: CustomerBotVersion; text: CustomerBotText };

function freshDraft(base: CustomerBotVersion): Draft {
  return { base, text: customerBotText(base) };
}

const descriptions = {
  instructions: "Tone, wording and the business policies that rarely change. Prices and offers come from Campaigns, so they don’t belong here.",
};

export function CustomerBotEditor({ initial, writable, draftKey }: {
  initial: CustomerBotVersion; writable: boolean; draftKey: string;
}) {
  const zone = useDisplayTimezone();
  const [live, setLive] = useState(initial);
  // Its own state: publishing instructions never moves the reply setting.
  const [replies, setReplies] = useState(initial.replies);
  const [draft, setDraft] = useState(() => freshDraft(initial));
  const [ready, setReady] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [restored, setRestored] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const requestInFlight = useRef(false);
  const reviewTitle = useRef<HTMLHeadingElement>(null);
  const sourceOnMount = useRef(initial);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Draft> | null;
        if (saved && isCustomerBotVersion(saved.base) && isCustomerBotText(saved.text) &&
            !sameCustomerBotText(customerBotText(saved.text), sourceOnMount.current)) {
          setDraft({ base: saved.base, text: saved.text });
          setRestored(true);
        }
      }
    } catch { setStorageFailed(true); }
    setReady(true);
  }, [draftKey]);

  const text = customerBotText(draft.text);
  const dirty = !sameCustomerBotText(text, draft.base);
  const conflict = dirty && draft.base.revision !== live.revision;
  const problems = CUSTOMER_BOT_FIELDS.map((field) => customerBotProblem(draft.text[field], field));
  const changed = CUSTOMER_BOT_FIELDS.filter((field) => text[field] !== live[field]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(draft));
      else sessionStorage.removeItem(draftKey);
    } catch { setStorageFailed(true); }
  }, [dirty, draft, draftKey, ready]);

  useEffect(() => {
    if (reviewing) reviewTitle.current?.focus();
  }, [reviewing]);

  function readLatest(latest: CustomerBotVersion) {
    setLive(latest);
    setChecking(false);
    if (sameCustomerBotText(latest, text)) {
      setDraft(freshDraft(latest));
      setReviewing(false);
      setRestored(false);
      setFeedback({ text: "Your changes are live. They’ll apply to the next customer reply." });
    } else if (latest.revision !== draft.base.revision) {
      setReviewing(false);
      setFeedback(null);
    } else {
      setFeedback({ text: "The live version hasn’t changed. Your draft is still here and you can retry publishing." });
    }
  }

  async function checkLive() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setPending(true);
    try {
      const result = await checkCustomerBotAction();
      if (result.kind === "live") {
        readLatest(result.live);
        return;
      }
    } catch { /* Keep the draft and the check requirement after a connection failure. */ }
    finally {
      requestInFlight.current = false;
      setPending(false);
    }
    setFeedback({ text: "The live version is still unavailable. Your draft is kept; check again before publishing.", error: true });
  }

  async function publish() {
    if (!ready || !writable || !reviewing || !changed.length || conflict || checking || problems.some(Boolean) || requestInFlight.current) return;
    requestInFlight.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const result = await publishCustomerBotAction(text, draft.base.revision);
      if ("live" in result) {
        readLatest(result.live);
        return;
      }
      if (result.kind === "error") {
        setFeedback({ text: result.detail, error: true });
        return;
      }
    } catch { /* The server may have published before the browser disconnected. */ }
    finally {
      requestInFlight.current = false;
      setPending(false);
    }
    setChecking(true);
    setFeedback({ text: "We couldn’t confirm the publish. Your draft is kept. Check the live version before trying again.", error: true });
  }

  function useLatestAsBase() {
    // A field untouched by the operator follows the newer live copy. Keep any
    // field they edited (or manually merged) and require a new review.
    setDraft({ base: live, text: {
      instructions: text.instructions === draft.base.instructions ? live.instructions : draft.text.instructions,
    } });
    setFeedback(null);
    setRestored(false);
  }

  const locked = !ready || pending || !writable;
  // Every button that publishes, checks or discards sits in the page's own
  // header, where every console screen keeps what it does. They used to
  // float under the page with nothing around them saying what they acted on.
  const actions = ready ? <>
    {!reviewing && dirty && !checking && <button type="button" className="btn" disabled={pending} onClick={() => {
      setDraft(freshDraft(live));
      setRestored(false);
      setFeedback(null);
    }}>Discard draft</button>}
    {reviewing && <button type="button" className="btn" disabled={pending} onClick={() => setReviewing(false)}>Continue editing</button>}
    {checking ? <button type="button" className="btn btn-primary" disabled={pending} onClick={checkLive}>{pending ? "Checking…" : "Check live version"}</button>
      : conflict ? <button type="button" className="btn btn-primary" disabled={locked} onClick={useLatestAsBase}>Use latest as base</button>
      : reviewing ? <button type="button" className="btn btn-primary" disabled={locked} onClick={publish}>{pending ? "Publishing…" : "Publish to WhatsApp bot"}</button>
      : <button type="button" className="btn btn-primary" disabled={locked || !dirty || problems.some(Boolean)} onClick={() => setReviewing(true)}>Review changes</button>}
  </> : null;

  // One textarea per field, drawn alone or beside the live text it conflicts with.
  function editor(field: typeof CUSTOMER_BOT_FIELDS[number], index: number) {
    return <textarea id={`customer-${field}`} className="customer-bot-input" rows={18} value={draft.text[field]} readOnly={locked}
      aria-describedby={`customer-${field}-help${problems[index] ? ` customer-${field}-error` : ""}`}
      aria-invalid={Boolean(problems[index])}
      onChange={(event) => setDraft({ ...draft, text: { ...draft.text, [field]: event.target.value } })} />;
  }

  const published = live.publishedAt
    ? <>Last published <time dateTime={live.publishedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(live.publishedAt))}</time>
        {live.publishedBy ? ` by ${live.publishedBy}` : null}</>
    : "Using the bot’s existing content";

  return (
    <div className="customer-bot page-stack" aria-busy={pending || !ready}>
      <PageHead title="Customer Bot"
        status={!ready ? null : <>
          {dirty
            ? <span className="pill pill-warning pill-dot">Unpublished changes</span>
            : <span className="pill pill-success pill-dot">Live</span>}
          {replyModePill(replies)}
        </>}
        subtitle={<>How Genaie replies to customers on WhatsApp · {published}</>}
        actions={actions} />

      {/* What the page has to say about the draft as a whole, under its
          heading rather than inside the card a review replaces. */}
      <div className="page-notices">
        {!writable && <p>The console is in read-only mode.</p>}
        {restored && <p role="status">Your draft was restored from this tab.</p>}
        {storageFailed && <p role="status">Browser storage is unavailable. Keep this page open to retain your draft.</p>}
        {feedback && <p className={feedback.error ? "customer-bot-error" : "is-ok"} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
        {conflict && <section className="customer-bot-conflict" role="status">
          <strong>Someone published changes since you started this draft.</strong>
          <p>Compare the latest live text with your draft and merge any changes you want to keep. Then use the latest version as the base for your review.</p>
        </section>}
      </div>

      <div className="page-columns">
        <div className="page-stack">
          {!ready ? <Section id="customer-loading"><p role="status">Loading draft…</p></Section>
            : reviewing ? (
              <Section id="customer-review" title="Review changes" titleRef={reviewTitle}
                description="Publishing updates the customer bot’s next WhatsApp reply, including in conversations already open.">
                {changed.map((field) => <div className="customer-bot-field" key={field}>
                  <h3 className="card-title">{CUSTOMER_BOT_LABELS[field]}</h3>
                  <ReviewText previous={live[field]} proposed={text[field]} />
                </div>)}
              </Section>
            ) : CUSTOMER_BOT_FIELDS.map((field, index) => (
              // The label stays inside the title: it is what names the textarea.
              <Section key={field} id={`customer-${field}`} flush className="customer-bot-editor"
                title={<label htmlFor={`customer-${field}`}>{CUSTOMER_BOT_LABELS[field]}</label>}
                description={<span id={`customer-${field}-help`}>{descriptions[field]}</span>}
                actions={<span className="card-note">{size(draft.text[field])} of 16 KB</span>}
                footer={problems[index] ? <p id={`customer-${field}-error`} className="customer-bot-error">{problems[index]}</p> : null}>
                {conflict ? <div className="customer-bot-compare">
                  <div><strong>Latest live text</strong><pre>{live[field]}</pre></div>
                  <div><strong>Your draft</strong>{editor(field, index)}</div>
                </div> : editor(field, index)}
              </Section>
            ))}
        </div>

        <aside className="page-stack">
          <ReplyModeCard replies={replies} writable={writable} onSaved={setReplies} />
          <Section id="customer-sources" title="Connected data sources"
            description="Looked up for every factual question, so answers stay current without a briefing."
            footer={<Link prefetch={false} className="link" href="/campaigns">Offers are edited in Campaigns</Link>}>
            <ul className="source-list">{live.sources.map((source) => <li key={source.id}>
              <span className="source-list-icon" aria-hidden><Database size={14} /></span>
              <span><strong>{source.label}</strong><span className="card-note">{source.description}</span></span>
            </li>)}</ul>
          </Section>
        </aside>
      </div>
    </div>
  );
}

/** How much of the bot's 16 KB a field uses, as the limit itself counts it. */
function size(text: string) {
  const kilobytes = new TextEncoder().encode(text).byteLength / 1024;
  return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`;
}

function ReviewText({ previous, proposed }: { previous: string; proposed: string }) {
  const before = previous.split("\n");
  const after = proposed.split("\n");
  let start = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  let end = 0;
  while (end < Math.min(before.length, after.length) - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
  return (
    <div className="customer-bot-compare">
      {([["Live version", before], ["Draft version", after]] as const).map(([label, lines]) => {
        const stop = lines.length - end;
        return <div key={label}><strong>{label}</strong><pre>
          {start > 2 ? "…\n" : ""}{lines.slice(Math.max(0, start - 2), start).map((line) => `${line}\n`).join("")}
          <mark>{lines.slice(start, stop).map((line) => `${line}\n`).join("")}</mark>
          {lines.slice(stop, stop + 2).join("\n")}{end > 2 ? "\n…" : ""}
        </pre></div>;
      })}
    </div>
  );
}
