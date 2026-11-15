"use client";

import { useEffect, useRef, useState } from "react";
import { useDisplayTimezone } from "@/app/_components/timezone-context";
import { checkCustomerBotAction, publishCustomerBotAction } from "../actions";
import {
  CUSTOMER_BOT_FIELDS, CUSTOMER_BOT_LABELS, customerBotProblem, customerBotText, isCustomerBotText,
  isCustomerBotVersion, sameCustomerBotText, type CustomerBotText, type CustomerBotVersion,
} from "@/src/lib/customer-bot-types";

type Draft = { base: CustomerBotVersion; text: CustomerBotText };

function freshDraft(base: CustomerBotVersion): Draft {
  return { base, text: customerBotText(base) };
}

const descriptions = {
  instructions: "Guide the bot’s tone, wording, and how it responds. Include examples if helpful.",
  knowledge: "Keep products, prices, services, and FAQs in one Markdown document. Borehole quotes and CV payments are managed separately.",
};

export function CustomerBotEditor({ initial, writable, draftKey }: {
  initial: CustomerBotVersion; writable: boolean; draftKey: string;
}) {
  const zone = useDisplayTimezone();
  const [live, setLive] = useState(initial);
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
      knowledge: text.knowledge === draft.base.knowledge ? live.knowledge : draft.text.knowledge,
    } });
    setFeedback(null);
    setRestored(false);
  }

  const locked = !ready || pending || !writable;
  return (
    <div className="customer-bot" aria-busy={pending || !ready}>
      <section className="card card-pad customer-bot-status" aria-label="Publishing status">
        <div>
          <strong>{live.publishedAt ? "Last published" : "Using existing bot content"}</strong>
          {live.publishedAt && <div className="card-note">
            <time dateTime={live.publishedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(live.publishedAt))}</time>
            {live.publishedBy && ` · ${live.publishedBy}`}
          </div>}
        </div>
        {dirty && <span className="pill pill-warning">Unpublished draft</span>}
      </section>
      {!writable && <p className="card-note">The console is in read-only mode.</p>}
      {restored && <p className="card-note" role="status">Your draft was restored from this tab.</p>}
      {storageFailed && <p className="card-note" role="status">Browser storage is unavailable. Keep this page open to retain your draft.</p>}
      {feedback && <p className={feedback.error ? "customer-bot-error" : "card-note"} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      {!ready ? <p role="status">Loading draft…</p> : (
        <>
          {conflict && <section className="banner customer-bot-conflict" role="status">
            <strong>Someone published changes since you started this draft.</strong>
            <p>Compare the latest live text with your draft and merge any changes you want to keep. Then use the latest version as the base for your review.</p>
          </section>}
          {reviewing ? (
            <section className="customer-bot-review" aria-labelledby="customer-review-title">
              <h2 id="customer-review-title" ref={reviewTitle} tabIndex={-1}>Review changes</h2>
              <p className="card-note">Publishing updates the customer bot’s next WhatsApp reply, including in conversations already open.</p>
              {changed.map((field) => <section className="card card-pad" key={field}>
                <h3 className="card-title">{CUSTOMER_BOT_LABELS[field]}</h3>
                <ReviewText previous={live[field]} proposed={text[field]} />
              </section>)}
            </section>
          ) : CUSTOMER_BOT_FIELDS.map((field, index) => (
            <section className="card card-pad" key={field}>
              <h2 className="card-title"><label htmlFor={`customer-${field}`}>{CUSTOMER_BOT_LABELS[field]}</label></h2>
              <p id={`customer-${field}-help`} className="card-note">{descriptions[field]}</p>
              <div className={conflict ? "customer-bot-compare" : undefined}>
                {conflict && <div><strong>Latest live text</strong><pre>{live[field]}</pre></div>}
                <div>
                  {conflict && <strong>Your draft</strong>}
                  <textarea id={`customer-${field}`} rows={12} value={draft.text[field]} readOnly={locked}
                    aria-describedby={`customer-${field}-help${problems[index] ? ` customer-${field}-error` : ""}`}
                    aria-invalid={Boolean(problems[index])}
                    onChange={(event) => setDraft({ ...draft, text: { ...draft.text, [field]: event.target.value } })} />
                  {problems[index] && <p id={`customer-${field}-error`} className="customer-bot-error">{problems[index]}</p>}
                </div>
              </div>
            </section>
          ))}
          <div className="customer-bot-actions">
            {reviewing && <button type="button" className="btn" disabled={pending} onClick={() => setReviewing(false)}>Continue editing</button>}
            {checking ? <button type="button" className="btn btn-primary" disabled={pending} onClick={checkLive}>{pending ? "Checking…" : "Check live version"}</button>
              : conflict ? <button type="button" className="btn btn-primary" disabled={locked} onClick={useLatestAsBase}>Use latest as base</button>
              : reviewing ? <button type="button" className="btn btn-primary" disabled={locked} onClick={publish}>{pending ? "Publishing…" : "Publish to WhatsApp bot"}</button>
              : <button type="button" className="btn btn-primary" disabled={locked || !dirty || problems.some(Boolean)} onClick={() => setReviewing(true)}>Review changes</button>}
          </div>
        </>
      )}
    </div>
  );
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
