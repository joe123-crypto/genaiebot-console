"use client";

import { useState, useId } from "react";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { Section } from "@/app/_components/ui";
import { announceSignOut, authMutation } from "@/src/lib/auth-browser";
import type { BotRemoval } from "@/src/domains/bot-provisioning";

export const DELETE_ACCOUNT_EXPLAINER =
  "Deleting your account removes your workspace and everything in it. This cannot be undone, and nothing here can bring it back.";
/**
 * What happens to the bot, said on the one screen where the user cannot check
 * afterwards. A bot this console created goes with the account, except that
 * Railway holds its storage for a few days before erasing it. A bot set up by
 * hand is not this console's to remove, and claiming the account was wholly
 * gone while it kept running would be a half-truth.
 */
export const DELETE_ACCOUNT_BOT_NOTES: Record<Exclude<BotRemoval, "none">, string> = {
  removed: "Your bot is shut down and removed with your account. Our hosting keeps its storage for a few days before erasing it.",
  manual: "Your bot was set up by hand, so it is not removed by this. It keeps running until an operator takes it down.",
};

export function DeleteAccountCard({ email, bot }: { email: string; bot: BotRemoval }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<{ detail: string } | null>(null);
  const [pending, setPending] = useState(false);
  const inputId = useId();
  const note = bot === "none" ? null : DELETE_ACCOUNT_BOT_NOTES[bot];

  // Typing the address is the pause. The button beside Cancel is one click
  // from unrecoverable, and a dialog alone is too cheap a gate for that.
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  function close() {
    setConfirming(false);
    setTyped("");
    setError(null);
  }

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await authMutation("DELETE", {}, "/api/workspace");
      // Drafts, pictures held for a new campaign, and any other open tab.
      announceSignOut();
      window.location.replace("/login");
    } catch (failure) {
      setError({ detail: failure instanceof Error ? failure.message : "Your account could not be deleted. Try again shortly." });
      setPending(false);
    }
  }

  return (
    <Section className="settings-card settings-danger">
      <div className="setting-row">
        <div className="setting-label">
          <h3 className="setting-name" id="delete-account-title">Delete account</h3>
          <span className="setting-hint">{DELETE_ACCOUNT_EXPLAINER}</span>
          <ul className="settings-danger-list">
            <li>Your groups, campaigns, schedule, lines and cap settings</li>
            <li>The pictures stored for your campaigns</li>
            {bot === "removed" ? <li>Your bot, and the WhatsApp connection it holds</li> : null}
            <li>The workspace itself</li>
            <li>Your sign-in to this console</li>
          </ul>
          {note ? <span className="setting-hint">{note}</span> : null}
        </div>
        <div className="setting-control">
          <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>Delete account</button>
        </div>
      </div>

      {confirming ? (
        <ConfirmDialog title="Delete your account?" confirmLabel="Delete account" pendingLabel="Deleting…"
          danger confirmDisabled={!matches} pending={pending} error={error}
          onConfirm={remove} onClose={close}>
          <p>{bot === "removed"
            ? "Your workspace, everything in it, your bot and your sign-in are deleted. This cannot be undone."
            : "Your workspace, everything in it and your sign-in are deleted. This cannot be undone."}</p>
          {note ? <p>{note}</p> : null}
          <div className="delete-account-confirm">
            <label className="modal-label" htmlFor={inputId}>Type <code>{email}</code> to confirm</label>
            <input id={inputId} className="modal-input" type="email" autoComplete="off"
              spellCheck={false} disabled={pending} value={typed}
              onChange={(event) => setTyped(event.target.value)} />
          </div>
        </ConfirmDialog>
      ) : null}
    </Section>
  );
}
