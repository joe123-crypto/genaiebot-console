"use client";

import { notifyLiveChange } from "@/app/_components/use-live";

import { useState, useTransition } from "react";
import { addDiscoveredGroupAction } from "@/app/groups/actions";
import type { WriteGate } from "@/src/lib/write-capabilities";

/** What adding does, said where the button is. */
export const ADD_EXPLAINER =
  "Adds it as active and in no campaign: nothing is sent to it until a campaign page assigns it.";

/**
 * Put a group the bot discovered on record. The server action looks the group
 * up in the bot's own discovered list, so only a group the bot has actually seen
 * can be added this way.
 */
export function AddDiscoveredGroup({ jid, label, gate }: {
  jid: string;
  label: string;
  gate: WriteGate;
}) {
  const [error, setError] = useState<{ detail: string; problems?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    if (pending || !gate.allowed) return;
    startTransition(async () => {
      const outcome = await addDiscoveredGroupAction(jid);
      // On success the revalidation moves the row into the groups table.
      if (outcome.ok) notifyLiveChange();
      setError(outcome.ok ? null : { detail: outcome.detail, problems: outcome.problems });
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={add}
        disabled={!gate.allowed || pending}
        title={gate.allowed ? ADD_EXPLAINER : gate.reason}
        aria-label={`Add ${label} to the bot`}
      >
        {pending ? "Adding…" : "Add to bot"}
      </button>
      {error ? (
        <div className="modal-error" role="alert">
          <p>{error.detail}</p>
          {error.problems?.length ? (
            <ul>{error.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
