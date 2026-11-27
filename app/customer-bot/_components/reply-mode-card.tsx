"use client";

import { useRef, useState } from "react";
import { useDisplayTimezone } from "@/app/_components/timezone-context";
import { Section } from "@/app/_components/ui";
import { setCustomerBotRepliesAction } from "../actions";
import type { CustomerBotReplies, CustomerBotReplyMode } from "@/src/lib/customer-bot-types";

export const REPLY_MODE_OPTIONS: { mode: CustomerBotReplyMode; label: string; description: string }[] = [
  { mode: "everyone", label: "Everyone", description: "Replies to every customer who messages." },
  { mode: "ref", label: "Customers from your ads", description: "Only customers who sent a ref code from a campaign link. Others get no reply, so you can answer them yourself." },
  { mode: "off", label: "Off", description: "The bot replies to no one. Messages wait for you in WhatsApp." },
];

/** The page heading's word for a mode that holds customers back. */
export function replyModePill(replies: CustomerBotReplies | null | undefined) {
  if (replies?.mode === "off") return <span className="pill pill-warning">Replies off</span>;
  if (replies?.mode === "ref") return <span className="pill pill-warning">Ads only</span>;
  return null;
}

/**
 * Who the bot replies to. It saves as soon as one is picked, apart from the
 * instructions' draft and review: it is one choice, and holding it in a draft
 * would leave customers answered (or not) while the operator reviews.
 */
export function ReplyModeCard({ replies, writable, onSaved }: {
  /** Absent: the bot is too old to choose. null: it could not read its setting. */
  replies: CustomerBotReplies | null | undefined;
  writable: boolean;
  onSaved: (replies: CustomerBotReplies) => void;
}) {
  const zone = useDisplayTimezone();
  const [pending, setPending] = useState<CustomerBotReplyMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const supported = replies !== undefined;
  const shown = pending ?? replies?.mode ?? null;

  async function choose(mode: CustomerBotReplyMode) {
    if (!writable || !supported || inFlight.current || mode === replies?.mode) return;
    inFlight.current = true;
    setPending(mode);
    setError(null);
    try {
      const result = await setCustomerBotRepliesAction(mode);
      if (result.kind === "saved") onSaved(result.replies);
      else {
        if (result.replies) onSaved(result.replies);
        setError(result.detail);
      }
    } catch {
      setError("We couldn’t confirm the change. Reload the page to see the current setting before trying again.");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  const footer = error ? <p className="customer-bot-error" role="alert">{error}</p>
    : !supported ? <p className="card-note">Update the bot to choose who it replies to.</p>
    : replies === null ? <p className="card-note" role="status">The bot couldn’t read this setting, so it replies to everyone. Choose one to save it again.</p>
    : pending ? <p className="card-note" role="status">Saving…</p>
    : replies.updatedAt ? <p className="card-note">Changed <time dateTime={replies.updatedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(replies.updatedAt))}</time>
        {replies.updatedBy ? ` by ${replies.updatedBy}` : null}</p>
    : null;

  return (
    <Section id="customer-replies" title="Who the bot replies to" busy={Boolean(pending)}
      description="Takes effect on the next customer message. Your own number always gets replies."
      footer={footer}>
      <fieldset className="reply-mode" aria-labelledby="customer-replies-title"
        disabled={!writable || !supported || Boolean(pending)}>
        {REPLY_MODE_OPTIONS.map((option) => (
          <label className="reply-mode-option" key={option.mode}>
            <input type="radio" name="customer-reply-mode" value={option.mode} checked={shown === option.mode}
              aria-describedby={`customer-replies-${option.mode}`} onChange={() => choose(option.mode)} />
            <span>
              <strong>{option.label}</strong>
              <span className="card-note" id={`customer-replies-${option.mode}`}>{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Section>
  );
}
