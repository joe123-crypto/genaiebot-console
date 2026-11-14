"use client";
import { useEffect, useRef, useState } from "react";
import { SyncNotice, useLivePage } from "./live-page";
import { LoadMore, useDebounced } from "./use-live";
import { plural } from "@/src/lib/format";
import type { CampaignRow, Group } from "@/src/lib/live-types";
import type { WriteOutcome } from "@/src/lib/write-outcome";
export type PickerChoice = { id: string; name: string; account?: string; status?: Group["status"] };

function activeCampaignLabel(group: Group, enabledCampaigns: Set<string> | undefined) {
  if (!enabledCampaigns) return "Campaign count unavailable";
  const paused = new Set(group.pausedPromos);
  const count = [...new Set(group.promos)].filter(slug => enabledCampaigns.has(slug) && !paused.has(slug)).length;
  return plural(count, "active campaign");
}

export function PaginatedPicker({ kind, exclude = [], close, choose }: {
  kind: "groups" | "campaigns"; exclude?: string[]; close: () => void;
  choose: (rows: PickerChoice[]) => void | Promise<WriteOutcome>;
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

  function dismiss() {
    if (!inFlight.current) close();
  }

  async function submit() {
    if (inFlight.current || selection.length === 0) return;
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
    <div ref={root}><h2 className="modal-title">Choose {kind}</h2><label className="modal-label" htmlFor={`picker-${kind}`}>Search {kind}</label>
      <input ref={input} id={`picker-${kind}`} className="modal-input" type="search" value={search} disabled={saving} onChange={event => setSearch(event.target.value)} />
      <SyncNotice sync={data.page?.sync} error={data.error} />
      <div className="campaign-group-options" role="group" aria-label={`Available ${kind}`} aria-busy={saving}>
        {choices.filter(({ choice }) => !exclude.includes(choice.id)).map(({ choice: row, campaignCountLabel }) => <label key={row.id} className="campaign-group-option" data-live-id={row.id}>
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
        </label>)}
      </div>
      <LoadMore next={data.page?.nextCursor} loading={data.loading} load={data.loadMore} />
      {error ? <div className="modal-error" role="alert">
        <p>{error.detail}</p>
        {error.problems?.length ? <ul>{error.problems.map(problem => <li key={problem}>{problem}</li>)}</ul> : null}
      </div> : null}
      <div className="modal-actions">
        {saving ? <span className="sr-only" role="status">Adding selected {kind}…</span> : null}
        <button className="btn" type="button" disabled={saving} onClick={dismiss}>Cancel</button>
        <button className="btn btn-primary" type="button" disabled={saving || selection.length === 0} onClick={submit}>
          {saving ? "Adding…" : `Add ${selection.length} selected`}
        </button>
      </div>
    </div></dialog>;
}
