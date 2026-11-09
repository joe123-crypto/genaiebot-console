"use client";

import { useEffect, useState, useTransition } from "react";
import { Pause, Play } from "lucide-react";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { setCampaignEnabledAction } from "@/app/campaigns/actions";
import type { WriteGate } from "@/src/lib/write-capabilities";

/** Said wherever the switch is, so nobody expects it to install a cron. */
export const NO_CRON_NOTE =
  "No cron is registered for this campaign, so it stays silent whatever this switch says. Registering one is done on the gateway, not here.";

/**
 * The operator's own on/off switch for a campaign.
 *
 * A campaign posts only when this switch is on AND a cron is registered for it.
 * This edits the first and only reports the second: when there is no cron the
 * switch still works, but the card says plainly that turning it on will not
 * make the campaign post.
 */
export function CampaignSwitch({ slug, title, storeEnabled, cronEnabled, gate }: {
  slug: string;
  title: string;
  storeEnabled: boolean;
  /** Absent from an older bot; only an explicit false says there is no cron. */
  cronEnabled?: boolean;
  gate: WriteGate;
}) {
  // What the operator asked for, fixed when they clicked: a refresh while the
  // question is open must not flip it under their cursor.
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
      if (outcome.ok) close();
      else setError({ detail: outcome.detail, problems: outcome.problems });
    });
  }

  const state = storeEnabled
    ? cronEnabled === false ? "Switched on, but not posting." : "Switched on."
    : "Switched off. It posts nothing until it is turned back on.";

  return (
    <section className="card card-pad campaign-switch" aria-label="Campaign switch">
      <div className="campaign-switch-row">
        <p className="card-note"><strong>{state}</strong></p>
        <button type="button" className="btn" disabled={!gate.allowed || pending}
          title={gate.allowed ? undefined : gate.reason}
          onClick={() => setTarget(!storeEnabled)}>
          {storeEnabled ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
          {storeEnabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      {cronEnabled === false ? <p className="card-note">{NO_CRON_NOTE}</p> : null}
      {!gate.allowed ? <p className="card-note">{gate.reason}</p> : null}
      {target !== null && gate.allowed ? (
        <ConfirmDialog
          title={`${target ? "Turn on" : "Turn off"} ${title}?`}
          confirmLabel={target ? "Turn on" : "Turn off"}
          danger={!target}
          warning={gate.warning}
          pending={pending}
          error={error}
          onConfirm={confirm}
          onClose={close}
        >
          {target
            ? <p>It posts to its groups from its next run.{cronEnabled === false ? ` ${NO_CRON_NOTE}` : ""}</p>
            : <p>It stops posting from its next run, until it is turned back on. Its groups, copy and pictures stay as they are. A run already under way finishes.</p>}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
