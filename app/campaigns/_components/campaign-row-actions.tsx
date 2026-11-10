"use client";

import { useEffect, useState, useTransition } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/app/_components/confirm-dialog";
import { deleteCampaignAction, setCampaignEnabledAction } from "@/app/campaigns/actions";
import {
  NO_CRON_NOTE, TURN_OFF_BODY, TURN_ON_BODY, switchTitle,
} from "@/app/campaigns/_components/campaign-switch";
import type { WriteGate } from "@/src/lib/write-capabilities";
import { groupDraftKey } from "@/src/lib/campaign-group-draft";

export function CampaignRowActions({
  slug, title, storeEnabled, cronEnabled, gate, deleteGate,
}: {
  slug: string;
  title: string;
  storeEnabled: boolean;
  /** Absent from an older bot; only an explicit false says there is no cron. */
  cronEnabled?: boolean;
  gate: WriteGate;
  deleteGate: WriteGate;
}) {
  // What the operator asked for, fixed when they clicked: the sixty-second
  // refresh must not flip the question under their cursor.
  const [target, setTarget] = useState<boolean | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<{ detail: string; problems?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!gate.allowed) setTarget(null);
  }, [gate.allowed]);

  useEffect(() => {
    if (!deleteGate.allowed) setDeleting(false);
  }, [deleteGate.allowed]);

  function close() {
    setDeleting(false);
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
        disabled={!gate.allowed || pending || deleting}
        title={gate.allowed ? undefined : gate.reason}
        aria-label={`${storeEnabled ? "Turn off" : "Turn on"} ${title}`}
      >
        {storeEnabled ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
      </button>

      <button
        type="button"
        className="row-action row-action-danger"
        disabled={!deleteGate.allowed || pending || target !== null}
        onClick={() => { setError(null); setDeleting(true); }}
        title={deleteGate.allowed ? undefined : deleteGate.reason}
        aria-label={`Delete ${title}`}
      >
        <Trash2 size={15} aria-hidden />
      </button>

      {deleting && deleteGate.allowed ? (
        <ConfirmDialog title={`Delete ${title}?`} confirmLabel="Delete campaign" danger
          pending={pending} error={error} onClose={close} onConfirm={() => {
            if (!deleteGate.allowed || pending) return;
            startTransition(async () => {
              try {
                const outcome = await deleteCampaignAction(slug);
                if (outcome.ok) {
                  try { localStorage.removeItem(groupDraftKey(slug)); } catch { /* Storage may be unavailable. */ }
                  close();
                } else setError({ detail: outcome.detail, problems: outcome.problems });
              } catch {
                setError({ detail: "The console did not confirm deletion. The campaign may have been deleted. Refresh before retrying." });
              }
            });
          }}>
          <p>Permanently delete {title}, remove its group assignments and scheduled jobs, and delete pictures used only by this campaign. This cannot be undone here.</p>
          <p>Remaining sends stop. A message already being submitted may still complete. Historical activity and audit records are kept. Cleanup retries automatically if needed.</p>
        </ConfirmDialog>
      ) : null}

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
