"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteGroupAction } from "@/app/groups/actions";

/**
 * What a delete actually does today, in one place.
 *
 * It is worth being plain about the half that is missing. The console can
 * remove a group from the bot's records; taking the bot's number out of the
 * WhatsApp group is a separate piece of work in genaebot and is not built, so
 * the dialog must not let an operator infer that the bot has left.
 */
export const DELETE_EXPLAINER =
  "The group is removed from the bot's records and stops appearing here.";
export const DELETE_CAVEAT =
  "The bot stays in the WhatsApp group — taking its number out is not built yet.";

/** Typing the name is the confirmation: a group the operator cannot name is a
 *  group they have not read the row of.
 *
 *  An empty expected label would be matched by an empty box, which is no
 *  confirmation at all, so it never matches. `confirmLabel` should already
 *  have fallen back to the jid; this is the second lock on the same door. */
export function confirmationMatches(typed: string, expected: string) {
  const wanted = expected.trim().toLowerCase();
  if (!wanted) return false;
  return typed.trim().toLowerCase() === wanted;
}

export function DeleteGroup({ jid, label }: { jid: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const armed = confirmationMatches(typed, label);

  function close() {
    setOpen(false);
    setTyped("");
    setError(null);
  }

  function submit() {
    if (!armed || pending) return;
    startTransition(async () => {
      const outcome = await deleteGroupAction(jid);
      if (outcome.ok) {
        // The row is about to be removed by the revalidation this action
        // triggered, so there is nothing to put the dialog back for.
        setOpen(false);
        setTyped("");
        setError(null);
        return;
      }
      setError(outcome.detail);
    });
  }

  return (
    <>
      <button
        type="button"
        className="row-action row-action-danger"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${label}`}
      >
        <Trash2 size={15} aria-hidden />
      </button>

      {open ? (
        <div className="modal-backdrop" role="presentation" onClick={close}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-group-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="modal-title" id="delete-group-title">
              Delete {label}?
            </h2>
            <p className="modal-body">
              {DELETE_EXPLAINER} <strong>{DELETE_CAVEAT}</strong>
            </p>
            <label className="modal-label" htmlFor="delete-group-confirm">
              Type <code>{label}</code> to confirm
            </label>
            <input
              id="delete-group-confirm"
              className="modal-input"
              value={typed}
              autoComplete="off"
              autoFocus
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
                if (event.key === "Escape") close();
              }}
            />
            {error ? <p className="modal-error">{error}</p> : null}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={close} disabled={pending}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={submit}
                disabled={!armed || pending}
              >
                {pending ? "Deleting…" : "Delete group"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
