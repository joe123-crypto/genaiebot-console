"use client";

import { useState, useId } from "react";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { announceSignOut, authMutation } from "@/src/lib/auth-browser";

export const DELETE_ACCOUNT_EXPLAINER =
  "Deleting your account removes your workspace and everything in it. This cannot be undone, and nothing here can bring it back.";
/** The bot is a service of its own, created by hand and holding its own
 *  pictures. Saying the account is gone while it keeps running would be a
 *  half-truth on the one screen where the user cannot check. */
export const DELETE_ACCOUNT_BOT_NOTE =
  "Your bot is not removed by this. It is a service of its own, and it keeps running with the pictures it has stored until an operator takes it down.";

export function DeleteAccountCard({ email }: { email: string }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<{ detail: string } | null>(null);
  const [pending, setPending] = useState(false);
  const inputId = useId();

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
    <section className="card card-pad settings-danger" aria-labelledby="delete-account-title">
      <h2 className="card-title" id="delete-account-title">Delete account</h2>
      <p className="card-note">{DELETE_ACCOUNT_EXPLAINER}</p>
      <ul>
        <li>Your groups, campaigns, schedule, lines and cap settings</li>
        <li>The workspace itself</li>
        <li>Your sign-in to this console</li>
      </ul>
      <p className="card-note">{DELETE_ACCOUNT_BOT_NOTE}</p>

      <div className="modal-actions">
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>Delete account</button>
      </div>

      {confirming ? (
        <ConfirmDialog title="Delete your account?" confirmLabel="Delete account" pendingLabel="Deleting…"
          danger confirmDisabled={!matches} pending={pending} error={error}
          onConfirm={remove} onClose={close}>
          <p>Your workspace, everything in it and your sign-in are deleted. This cannot be undone.</p>
          <p>{DELETE_ACCOUNT_BOT_NOTE}</p>
          <div className="delete-account-confirm">
            <label className="modal-label" htmlFor={inputId}>Type <code>{email}</code> to confirm</label>
            <input id={inputId} className="modal-input" type="email" autoComplete="off"
              spellCheck={false} disabled={pending} value={typed}
              onChange={(event) => setTyped(event.target.value)} />
          </div>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
