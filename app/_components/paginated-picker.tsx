"use client";
import { useEffect, useRef, useState } from "react";
import { SyncNotice, useLivePage } from "./live-page";
import { LoadMore, useDebounced } from "./use-live";
import type { CampaignRow, Group } from "@/src/lib/live-types";
export type PickerChoice = { id: string; name: string; account?: string; status?: Group["status"] };
export function PaginatedPicker({ kind, exclude = [], multiple = true, close, choose }: {
  kind: "groups" | "campaigns"; exclude?: string[]; multiple?: boolean; close: () => void;
  choose: (rows: PickerChoice[]) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, PickerChoice>>({});
  const q = useDebounced(search, 300);
  const query = new URLSearchParams({ q, ...(kind === "groups" ? { status: "active" } : {}) }).toString();
  const data = useLivePage<Group | CampaignRow>(kind, null, query, row => "jid" in row ? row.jid : row.slug, root);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); input.current?.focus();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); }; }, []);
  const choices: PickerChoice[] = data.rows.map(row => "jid" in row ? { id: row.jid, name: row.name || row.jid, account: row.account, status: row.status } : { id: row.slug, name: row.name || row.slug });
  return <dialog ref={dialog} className="campaign-group-dialog" aria-label={`Choose ${kind}`} onCancel={event => { event.preventDefault(); close(); }}>
    <div ref={root}><h2 className="modal-title">Choose {kind}</h2><label className="modal-label" htmlFor={`picker-${kind}`}>Search {kind}</label>
      <input ref={input} id={`picker-${kind}`} className="modal-input" type="search" value={search} onChange={event => setSearch(event.target.value)} />
      <SyncNotice sync={data.page?.sync} error={data.error} />
      <div className="campaign-group-options">{choices.filter(row => !exclude.includes(row.id)).map(row => <label key={row.id} className="campaign-group-option" data-live-id={row.id}>
        {multiple ? <input type="checkbox" checked={Boolean(selected[row.id])} onChange={event => setSelected(previous => { const next = { ...previous }; if (event.target.checked) next[row.id] = row; else delete next[row.id]; return next; })} /> : null}
        {multiple ? <span>{row.name} {row.account ? `· ${row.account}` : ""}</span> : <button type="button" className="btn" onClick={() => choose([row])}>{row.name}</button>}
      </label>)}</div>
      <LoadMore next={data.page?.nextCursor} loading={data.loading} load={data.loadMore} />
      <div className="modal-actions"><button className="btn" type="button" onClick={close}>Cancel</button>
        {multiple ? <button className="btn btn-primary" type="button" disabled={!Object.keys(selected).length} onClick={() => choose(Object.values(selected))}>Add {Object.keys(selected).length} selected</button> : null}</div>
    </div></dialog>;
}
