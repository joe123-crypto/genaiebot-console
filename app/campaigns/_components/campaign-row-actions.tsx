"use client";

import { useEffect, useState, useTransition } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { setCampaignEnabledAction } from "@/app/campaigns/actions";
import {
  NO_CRON_NOTE, TURN_OFF_BODY, TURN_ON_BODY, switchTitle,
} from "@/app/campaigns/_components/campaign-switch";
import type { WriteGate } from "@/src/lib/write-capabilities";

/**
 * The row's own controls: the operator's on/off switch, and the delete that is
 * not available.
 *
 * This is the same switch as the card on the campaign's own page, asking the
 * same question with the same words -- an operator stopping a campaign from the
 * table should not have to open it first. The campaign still posts only when
 * this switch is on AND a cron is registered, which only the card has room to
 * explain; the row says it in the confirm dialog, where it matters.
 */
export function CampaignRowActions({
  slug, title, storeEnabled, cronEnabled, gate, deleteReason,
}: {
  slug: string;
  title: string;
  storeEnabled: boolean;
  /** Absent from an older bot; only an explicit false says there is no cron. */
  cronEnabled?: boolean;
  gate: WriteGate;
  deleteReason: string;
}) {
  // What the operator asked for, fixed when they clicked: the sixty-second
  // refresh must not flip the question under their cursor.
  const [target, setTarget] = useState<boolean | null>(null);
  const [error, setError] = useState<{ detail: string; problems?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!gate.allowed) setTarget(null);
  }, [gate.allowed]);

  function close() {
    setTarget(null);
    setError(null);
  }

  function confirm() {
    if (target === null || !gate.allowed || pending) return;
    startTransition(async () => {
      const outcome = await setCampaignEnabledAction(slug, target);
      // The row is about to be redrawn by the revalidation this action
      // triggered, so there is nothing to put the dialog back for.
      if (outcome.ok) close();
      else setError({ detail: outcome.detail, problems: outcome.problems });
    });
  }

  return (
    <>
      <button
        type="button"
        className="row-action"
        onClick={() => setTarget(!storeEnabled)}
        disabled={!gate.allowed || pending}
        title={gate.allowed ? undefined : gate.reason}
        aria-label={`${storeEnabled ? "Turn off" : "Turn on"} ${title}`}
      >
        {storeEnabled ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
      </button>

      <button
        type="button"
        className="row-action row-action-danger"
        disabled
        title={deleteReason}
        aria-label={`Delete ${title}`}
      >
        <Trash2 size={15} aria-hidden />
      </button>

      {target !== null && gate.allowed ? (
        <ConfirmDialog
          title={switchTitle(target, title)}
          confirmLabel={target ? "Turn on" : "Turn off"}
          danger={!target}
          warning={gate.warning}
          pending={pending}
          error={error}
          onConfirm={confirm}
          onClose={close}
        >
          {target
            ? <p>{TURN_ON_BODY}{cronEnabled === false ? ` ${NO_CRON_NOTE}` : ""}</p>
            : <p>{TURN_OFF_BODY}</p>}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
