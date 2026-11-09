"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type RefObject } from "react";
import { Plus, X } from "lucide-react";
import { addGroupCampaignAction } from "@/app/groups/actions";
import { campaignTitle, confirmLabel } from "@/src/lib/format";
import type { Campaign, Group } from "@/src/lib/types";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { WriteOutcome } from "@/src/lib/write-outcome";

export type GroupCampaignOption = Pick<Campaign, "slug" | "name" | "enabled">;

type Props = {
  group: Group;
  campaigns: GroupCampaignOption[];
  gate: WriteGate;
};

function CampaignSelector({ group, campaigns, gate, blockedReason, trigger, close }: Props & {
  blockedReason: string | undefined;
  trigger: RefObject<HTMLButtonElement | null>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const returnToTable = useRef(false);
  const id = useId();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<Extract<WriteOutcome, { ok: false }> | null>(null);
  const [pending, startTransition] = useTransition();
  const query = search.trim().toLowerCase();
  const matches = campaigns.filter((campaign) =>
    `${campaignTitle(campaign.slug)} ${campaign.name} ${campaign.slug}`.toLowerCase().includes(query));

  useEffect(() => {
    const element = dialog.current;
    const button = trigger.current;
    const fallback = button?.closest<HTMLElement>("[role='region']");
    element?.showModal();
    searchInput.current?.focus();
    return () => {
      element?.close();
      function restoreFocus() {
        if (button?.isConnected && !button.disabled && !returnToTable.current) button.focus();
        else if (fallback?.isConnected) fallback.focus();
      }
      restoreFocus();
      // Revalidation may disable or remove the trigger after the dialog closes.
      // Let that commit finish before recovering focus lost to the body.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body || (document.activeElement === button && button?.disabled)) {
          restoreFocus();
        }
      });
    };
  }, [trigger]);

  function dismiss() {
    if (!inFlight.current) close();
  }

  function add(slug: string) {
    if (blockedReason || inFlight.current) return;
    inFlight.current = true;
    setSaving(slug);
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await addGroupCampaignAction(group.jid, slug);
        if (outcome.ok) {
          returnToTable.current = campaigns.length === 1;
          close();
        } else setError(outcome);
      } catch {
        setError({ ok: false, detail: "The campaign could not be added. Try again." });
      } finally {
        inFlight.current = false;
        setSaving(null);
      }
    });
  }

  return (
    <dialog ref={dialog} className="campaign-group-dialog group-campaign-dialog"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}
      onCancel={(event) => { event.preventDefault(); dismiss(); }}>
      <div className="campaign-group-dialog-head">
        <h2 className="modal-title" id={`${id}-title`}>Add campaign to {confirmLabel(group)}</h2>
        <button type="button" className="row-action" aria-label="Close campaign selector"
          disabled={pending} onClick={dismiss}>
          <X size={18} aria-hidden />
        </button>
      </div>
      <p className="modal-body" id={`${id}-help`}>Select a campaign to add it immediately. Changes take effect from the campaign&apos;s next run.</p>
      {gate.allowed && gate.warning ? <p className="modal-warning">{gate.warning}</p> : null}
      {blockedReason ? <p className="modal-warning" role="status">{blockedReason}</p> : null}
      <label className="modal-label" htmlFor={`${id}-search`}>Search campaigns</label>
      <input ref={searchInput} id={`${id}-search`} className="modal-input" type="search"
        value={search} disabled={pending} placeholder="Search campaigns…"
        onChange={(event) => setSearch(event.target.value)} />
      <div className="campaign-group-options" role="group" aria-label="Available campaigns" aria-busy={pending}>
        {matches.map((campaign) => (
          <button type="button" key={campaign.slug} className="group-campaign-option"
            disabled={pending || Boolean(blockedReason)} onClick={() => add(campaign.slug)}>
            <span>{campaignTitle(campaign.slug)}{campaign.enabled ? "" : " (off)"}</span>
            {saving === campaign.slug ? <span role="status">Adding…</span> : <Plus size={15} aria-hidden />}
          </button>
        ))}
        {matches.length === 0 ? <p className="card-note">{campaigns.length === 0 ? "No more campaigns to add." : "No campaigns match your search."}</p> : null}
      </div>
      {error ? (
        <div className="modal-error" role="alert">
          <p>{error.detail}</p>
          {error.problems?.length ? <ul>{error.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function AddGroupCampaign({ group, campaigns, gate }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  // A successful assignment can remove this row from the "no campaign" view.
  // Move focus before React removes the focused trigger or its open dialog.
  useLayoutEffect(() => {
    const cell = trigger.current?.parentElement;
    const region = trigger.current?.closest<HTMLElement>("[role='region']");
    return () => {
      if (!cell?.contains(document.activeElement)) return;
      cell.querySelector("dialog")?.close();
      region?.focus();
    };
  }, []);

  const available = campaigns.filter((campaign) => !group.promos.includes(campaign.slug));
  const reason = !gate.allowed ? gate.reason
    : group.status !== "active" ? "Only active groups can be added to a campaign."
      : campaigns.length === 0 ? "No campaigns are available."
        : available.length === 0 ? "All campaigns are already assigned to this group."
          : undefined;

  return (
    <>
      <button ref={trigger} type="button" className="row-action group-campaign-add"
        aria-label={`Add campaign to ${confirmLabel(group)}`} aria-haspopup="dialog"
        disabled={Boolean(reason)} title={reason ?? "Add campaign"} onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden />
      </button>
      {open ? <CampaignSelector group={group} campaigns={available} gate={gate} blockedReason={reason}
        trigger={trigger} close={() => setOpen(false)} /> : null}
    </>
  );
}
