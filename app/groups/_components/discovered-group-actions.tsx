"use client";

import { notifyLiveChange } from "@/app/_components/use-live";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { addDiscoveredGroupAction, removeDiscoveredGroupAction } from "@/app/groups/actions";
import type { WriteGate } from "@/src/lib/write-capabilities";

/** What adding does, said where the button is. */
export const ADD_EXPLAINER =
  "Adds it as active and in no campaign: nothing is sent to it until a campaign page assigns it.";

export function DiscoveredGroupActions({ jid, label, lastSeenAt, addGate, removeGate }: {
  jid: string;
  label: string;
  lastSeenAt: string;
  addGate?: WriteGate;
  removeGate?: WriteGate;
}) {
  const [addError, setAddError] = useState<{ detail: string; problems?: string[] } | null>(null);
  const [confirmation, setConfirmation] = useState<{ label: string; observedThrough: string } | null>(null);
  const [removeError, setRemoveError] = useState<{ detail: string; problems?: string[]; refreshLive?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = confirmation !== null && confirmation.observedThrough !== lastSeenAt;

  function add() {
    if (pending || confirmation || !addGate?.allowed) return;
    startTransition(async () => {
      const outcome = await addDiscoveredGroupAction(jid);
      if (outcome.ok) notifyLiveChange();
      setAddError(outcome.ok ? null : outcome);
    });
  }

  function closeConfirmation() {
    setConfirmation(null);
    setRemoveError(null);
  }

  function remove() {
    if (!confirmation || !removeGate?.allowed || pending || changed || removeError?.refreshLive) return;
    startTransition(async () => {
      const outcome = await removeDiscoveredGroupAction(jid, confirmation.observedThrough);
      if (outcome.ok) closeConfirmation();
      else setRemoveError(outcome);
      if (outcome.ok || outcome.refreshLive) notifyLiveChange();
    });
  }

  return (
    <>
      <div className="discovered-group-actions">
        {addGate ? (
          <button
            type="button"
            className="btn"
            onClick={add}
            disabled={!addGate.allowed || pending || confirmation !== null}
            title={addGate.allowed ? ADD_EXPLAINER : addGate.reason}
            aria-label={`Add ${label} to the bot`}
          >
            {pending && !confirmation ? "Adding…" : "Add to bot"}
          </button>
        ) : null}
        {removeGate ? (
          <button
            type="button"
            className="btn"
            onClick={() => setConfirmation({ label, observedThrough: lastSeenAt })}
            disabled={!removeGate.allowed || pending || confirmation !== null}
            title={removeGate.allowed ? undefined : removeGate.reason}
            aria-label={`Remove ${label} from Unassigned`}
          >
            Remove
          </button>
        ) : null}
      </div>
      {addError ? (
        <div className="modal-error" role="alert">
          <p>{addError.detail}</p>
          {addError.problems?.length ? (
            <ul>{addError.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          ) : null}
        </div>
      ) : null}
      {confirmation ? (
        <ConfirmDialog
          title={`Remove ${confirmation.label} from Unassigned?`}
          confirmLabel="Remove from Unassigned"
          confirmDisabled={changed || removeError?.refreshLive || !removeGate?.allowed}
          danger
          pending={pending}
          error={removeError ?? (changed ? { detail: "This group’s discovery observation changed. Review the updated row before removing it." } : null)}
          onConfirm={remove}
          onClose={closeConfirmation}
        >
          This removes the saved discovery observation. A later WhatsApp scan can bring the group back.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
