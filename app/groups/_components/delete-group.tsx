"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteGroupAction } from "@/app/groups/actions";
import type { WriteGate } from "@/src/lib/write-capabilities";

/**
 * What a delete actually does, in one place.
 *
 * A delete removes the group from the bot's records and nothing else. Two extra
 * things can be asked for alongside it, and both are off unless ticked: taking
 * the bot's number out of the WhatsApp group, and forgetting what the bot stored
 * about the group while it advertised there. The copy below has to be exact
 * about which of those happened, because the row disappears the moment it does.
 */
export const DELETE_EXPLAINER =
  "The group leaves the bot's records and every campaign. Its full record is kept in the audit trail.";
export const DELETE_CAVEAT =
  "On its own this does not touch WhatsApp: the bot stays in the group, so it comes back under Unassigned.";
/** The gentler way out, which keeps the group's campaigns for later. */
export const DELETE_ALTERNATIVE =
  "To stop advertising but keep its campaigns, set its status to on hold instead.";

export const LEAVE_LABEL = "Also take the bot's number out of the WhatsApp group";
export const LEAVE_HINT =
  "Issued from this group's line only. Getting back in needs a new invite, and if another line is also a member the group stays listed.";
export const CLEAR_LABEL = "Also clear what the bot has stored for this group";
export const CLEAR_HINT =
  "Forgets which day each campaign last posted here. Replies already counted are kept.";

const ALLOWED: WriteGate = { allowed: true };

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

export function DeleteGroup({ jid, label, account, gate = ALLOWED,
                              leaveGate = ALLOWED, clearGate = ALLOWED }: {
  jid: string;
  label: string;
  /** The line that is in the group. Sent with the delete, because the record
   *  that names it is gone by the time the bot is asked to leave. */
  account?: string;
  /** Whether the bot will take a delete; the button says why when it will not. */
  gate?: WriteGate;
  /** Whether the bot will leave a WhatsApp group, and clear a group's records.
   *  Separate from `gate`: neither writes config, so an older bot can accept
   *  the delete and refuse these. */
  leaveGate?: WriteGate;
  clearGate?: WriteGate;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [leave, setLeave] = useState(false);
  const [clearRecords, setClearRecords] = useState(false);
  const [error, setError] = useState<{ detail: string; problems?: string[] } | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  const armed = confirmationMatches(typed, label);

  function close() {
    setOpen(false);
    setTyped("");
    setReason("");
    setLeave(false);
    setClearRecords(false);
    setError(null);
    setWarnings(null);
  }

  function submit() {
    if (!armed || pending) return;
    startTransition(async () => {
      const outcome = await deleteGroupAction(jid, {
        reason,
        leave: leave && leaveGate.allowed,
        clearRecords: clearRecords && clearGate.allowed,
        account,
      });
      if (outcome.ok) {
        // The record is gone. If something asked for alongside it did not come
        // off, this dialog is the last place that can say so -- the row is
        // about to be removed by the revalidation this action triggered.
        if (outcome.warnings?.length) {
          setError(null);
          setWarnings(outcome.warnings);
          return;
        }
        close();
        return;
      }
      setError({ detail: outcome.detail, problems: outcome.problems });
    });
  }

  return (
    <>
      <button
        type="button"
        className="row-action row-action-danger"
        onClick={() => setOpen(true)}
        disabled={!gate.allowed}
        title={gate.allowed ? undefined : gate.reason}
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
              {warnings ? `Deleted ${label}` : `Delete ${label}?`}
            </h2>
            {warnings ? (
              <>
                <p className="modal-body">
                  The group is gone from the bot&rsquo;s records. Not everything asked for
                  alongside it came off:
                </p>
                <div className="modal-warning" role="alert">
                  <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-primary" onClick={close} autoFocus>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-body">
                  {DELETE_EXPLAINER} <strong>{DELETE_CAVEAT}</strong> {DELETE_ALTERNATIVE}
                </p>
                {gate.allowed && gate.warning ? <p className="modal-warning">{gate.warning}</p> : null}

                <fieldset className="delete-group-extras" disabled={pending}>
                  <legend className="modal-label">Alongside the delete</legend>
                  <label className="delete-group-extra"
                    title={leaveGate.allowed ? undefined : leaveGate.reason}>
                    <input
                      type="checkbox"
                      checked={leave && leaveGate.allowed}
                      disabled={!leaveGate.allowed}
                      onChange={(event) => setLeave(event.target.checked)}
                    />
                    <span>
                      <span className="cell-strong">{LEAVE_LABEL}</span>
                      <span className="delete-group-hint">
                        {leaveGate.allowed ? LEAVE_HINT : leaveGate.reason}
                      </span>
                    </span>
                  </label>
                  <label className="delete-group-extra"
                    title={clearGate.allowed ? undefined : clearGate.reason}>
                    <input
                      type="checkbox"
                      checked={clearRecords && clearGate.allowed}
                      disabled={!clearGate.allowed}
                      onChange={(event) => setClearRecords(event.target.checked)}
                    />
                    <span>
                      <span className="cell-strong">{CLEAR_LABEL}</span>
                      <span className="delete-group-hint">
                        {clearGate.allowed ? CLEAR_HINT : clearGate.reason}
                      </span>
                    </span>
                  </label>
                </fieldset>

                <label className="modal-label" htmlFor="delete-group-reason">
                  Reason (kept in the audit trail, optional)
                </label>
                <input
                  id="delete-group-reason"
                  className="modal-input"
                  value={reason}
                  maxLength={500}
                  autoComplete="off"
                  onChange={(event) => setReason(event.target.value)}
                  style={{ marginBottom: 12 }}
                />
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
                {error ? (
                  <div className="modal-error" role="alert">
                    <p>{error.detail}</p>
                    {error.problems?.length ? (
                      <ul>{error.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                    ) : null}
                  </div>
                ) : null}
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
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
