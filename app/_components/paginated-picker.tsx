"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SyncNotice, useLivePage } from "./live-page";
import { LoadMore, useDebounced } from "./use-live";
import { Days } from "./weekdays";
import { plural } from "@/src/lib/format";
import { ALL_WEEKDAYS } from "@/src/domains/campaign-days";
import type { CampaignRow, Group } from "@/src/lib/live-types";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { WriteOutcome } from "@/src/lib/write-outcome";
/** `weekdays` is set only where the caller offers a schedule and the operator
 *  restricted this row: absent means "leave the posting days as they are". */
export type PickerChoice = { id: string; name: string; account?: string; status?: Group["status"]; weekdays?: number[] };

function activeCampaignLabel(group: Group, enabledCampaigns: Set<string> | undefined) {
  if (!enabledCampaigns) return "Campaign count unavailable";
  const paused = new Set(group.pausedPromos);
  const count = [...new Set(group.promos)].filter(slug => enabledCampaigns.has(slug) && !paused.has(slug)).length;
  return plural(count, "active campaign");
}

export function PaginatedPicker({ kind, exclude = [], close, choose, schedule, children }: {
  kind: "groups" | "campaigns"; exclude?: string[]; close: () => void;
  choose: (rows: PickerChoice[]) => void | Promise<WriteOutcome>;
  /** Offers posting days per chosen row. Absent leaves the dialog as it was. */
  schedule?: { gate: WriteGate };
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Map<string, PickerChoice>());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Extract<WriteOutcome, { ok: false }> | null>(null);
  const q = useDebounced(search, 300);
  const query = new URLSearchParams({ q, ...(kind === "groups" ? { status: "active" } : {}) }).toString();
  const data = useLivePage<Group | CampaignRow>(kind, null, query, row => "jid" in row ? row.jid : row.slug, root);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const campaigns = kind === "groups" ? data.page?.facets?.campaigns : undefined;
  const enabledCampaigns = campaigns && new Set(campaigns.filter(campaign => campaign.enabled).map(campaign => campaign.slug));
  const choices = data.rows.map(row => {
    if ("jid" in row) {
      const choice: PickerChoice = { id: row.jid, name: row.name || row.jid, account: row.account, status: row.status };
      return { choice, campaignCountLabel: activeCampaignLabel(row, enabledCampaigns) };
    }
    const choice: PickerChoice = { id: row.slug, name: row.name || row.slug };
    return { choice, campaignCountLabel: null };
  });
  const selection = Array.from(selected.values()).filter(row => !exclude.includes(row.id));
  const offerDays = Boolean(schedule?.gate.allowed);
  // A row restricted to no day at all is not a restriction the bot accepts, so
  // the dialog holds rather than sending something it knows will be refused.
  const incomplete = selection.some(row => row.weekdays?.length === 0);

  function setDays(id: string, weekdays: number[] | undefined) {
    setSelected(previous => {
      const row = previous.get(id);
      if (!row) return previous;
      const next = new Map(previous);
      if (weekdays) next.set(id, { ...row, weekdays });
      else { const { weekdays: _dropped, ...rest } = row; next.set(id, rest); }
      return next;
    });
  }

  function dismiss() {
    if (!inFlight.current) close();
  }

  async function submit() {
    if (inFlight.current || incomplete || selection.length === 0) return;
    inFlight.current = true;
    setError(null);
    try {
      const result = choose(selection);
      if (result) {
        setSaving(true);
        const outcome = await result;
        if (outcome.ok) close();
        else setError(outcome);
      }
    } catch {
      setError({ ok: false, detail: `The selected ${kind} could not be added. Try again.` });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="campaign-group-dialog" aria-label={`Choose ${kind}`} onCancel={event => { event.preventDefault(); dismiss(); }}>
    <div ref={root}><h2 className="modal-title">Choose {kind}</h2>
      {children}
      <label className="modal-label" htmlFor={`picker-${kind}`}>Search {kind}</label>
      <input ref={input} id={`picker-${kind}`} className="modal-input" type="search" value={search} disabled={saving} onChange={event => setSearch(event.target.value)} />
      <SyncNotice sync={data.page?.sync} error={data.error} />
      {schedule && !schedule.gate.allowed ? <p className="card-note">{schedule.gate.reason}</p> : null}
      <div className="campaign-group-options" role="group" aria-label={`Available ${kind}`} aria-busy={saving}>
        {choices.filter(({ choice }) => !exclude.includes(choice.id)).map(({ choice: row, campaignCountLabel }) => {
          const chosen = selected.get(row.id);
          return <div key={row.id} className="campaign-group-option-row" data-live-id={row.id}>
            {/* The weekday boxes sit beside this label, never inside it: a day
                ticked within the label would toggle the campaign itself. */}
            <label className="campaign-group-option">
              <input type="checkbox" checked={selected.has(row.id)} disabled={saving} onChange={event => {
                const { checked } = event.currentTarget;
                setSelected(previous => {
                  const next = new Map(previous);
                  if (checked) next.set(row.id, row);
                  else next.delete(row.id);
                  return next;
                });
              }} />
              <span>{row.name} {row.account ? `· ${row.account}` : ""}</span>
              {campaignCountLabel ? <span className="pill picker-campaign-count">{campaignCountLabel}</span> : null}
            </label>
            {offerDays && chosen ? <div className="campaign-group-option-schedule">
              <label className="campaign-check">
                <input type="checkbox" checked={chosen.weekdays !== undefined} disabled={saving}
                  onChange={event => setDays(row.id, event.currentTarget.checked ? [...ALL_WEEKDAYS] : undefined)} />
                Only on certain days
              </label>
              {chosen.weekdays !== undefined ? <>
                <Days label={`Posting days for ${row.name}`} value={chosen.weekdays} disabled={saving}
                  onChange={weekdays => setDays(row.id, weekdays)} />
                <p className="card-note">{chosen.weekdays.length === ALL_WEEKDAYS.length
                  ? "Every day: this clears any day restriction the groups already have."
                  : chosen.weekdays.length === 0
                    ? "Choose at least one day, or untick to leave the posting days alone."
                    : "A day this campaign is not scheduled to run on never posts."}</p>
              </> : null}
            </div> : null}
          </div>;
        })}
      </div>
      <LoadMore next={data.page?.nextCursor} loading={data.loading} load={data.loadMore} />
      {error ? <div className="modal-error" role="alert">
        <p>{error.detail}</p>
        {error.problems?.length ? <ul>{error.problems.map(problem => <li key={problem}>{problem}</li>)}</ul> : null}
      </div> : null}
      <div className="modal-actions">
        {saving ? <span className="sr-only" role="status">Adding selected {kind}…</span> : null}
        <button className="btn" type="button" disabled={saving} onClick={dismiss}>Cancel</button>
        <button className="btn btn-primary" type="button" disabled={saving || incomplete || selection.length === 0} onClick={submit}>
          {saving ? "Adding…" : `Add ${selection.length} selected`}
        </button>
      </div>
    </div></dialog>;
}
