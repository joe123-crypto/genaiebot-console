"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Pause, Play, Plus, Trash2, X } from "lucide-react";
import { groupLabel, plural, shortJid } from "@/src/lib/format";
import {
  emptyGroupDraft, groupDraftKey, hasGroupDraft, parseGroupDraft, reconcileGroupDraft,
  type CampaignGroupDraft, type CampaignGroupRow, type KnownCampaignGroup,
} from "@/src/lib/campaign-group-draft";

type Props = {
  slug: string;
  liveGroups: CampaignGroupRow[];
  knownGroups: KnownCampaignGroup[];
  variantCount: number;
};

function RemoveGroupDialog({ group, close, confirm, fallbackFocus }: {
  group: Pick<KnownCampaignGroup, "jid" | "name">;
  close: () => void;
  confirm: () => void;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus();
      else fallbackFocus.current?.focus();
    };
  }, [fallbackFocus]);

  return (
    <dialog ref={dialog} className="campaign-group-dialog" role="alertdialog"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <h2 className="modal-title" id={`${id}-title`}>Remove group from campaign?</h2>
      <p className="modal-body" id={`${id}-help`}>
        <strong>{groupLabel(group)}</strong> ({shortJid(group.jid)}) will be removed from this campaign’s browser draft.
        {" "}You can add it again later.
      </p>
      <div className="modal-actions">
        <button ref={cancel} type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={confirm}>Remove group</button>
      </div>
    </dialog>
  );
}

function AddGroupsDialog({ groups, close, add }: {
  groups: KnownCampaignGroup[];
  close: () => void;
  add: (jids: string[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const available = new Set(groups.map((group) => group.jid));
  const validSelection = selected.filter((jid) => available.has(jid));
  const query = search.trim().toLowerCase();
  const matches = groups.filter((group) =>
    `${groupLabel(group)} ${group.jid} ${group.account}`.toLowerCase().includes(query));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    searchInput.current?.focus();
    return () => { element?.close(); previous?.focus(); };
  }, []);

  return (
    <dialog ref={dialog} className="campaign-group-dialog" aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`} onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="campaign-group-dialog-head">
        <h2 className="modal-title" id={`${id}-title`}>Add groups</h2>
        <button type="button" className="row-action" aria-label="Close add groups" onClick={close}>
          <X size={18} aria-hidden />
        </button>
      </div>
      <p className="modal-body" id={`${id}-help`}>Choose active groups from the Groups list to add to this campaign’s browser draft.</p>
      <label className="modal-label" htmlFor={`${id}-search`}>Search by group name, ID or line</label>
      <input ref={searchInput} id={`${id}-search`} className="modal-input" type="search" value={search}
        onChange={(event) => setSearch(event.target.value)} placeholder="Search groups…" />
      <div className="campaign-group-options" role="group" aria-label="Available groups">
        {matches.map((group) => (
          <label key={group.jid} className="campaign-group-option">
            <input type="checkbox" checked={validSelection.includes(group.jid)} onChange={(event) => {
              setSelected(event.target.checked ? [...validSelection, group.jid] : validSelection.filter((jid) => jid !== group.jid));
            }} />
            <span>
              <span className="cell-strong">{groupLabel(group)}</span>
              <span className="cell-mono">{shortJid(group.jid)} · {group.account}</span>
            </span>
          </label>
        ))}
        {matches.length === 0 ? <p className="empty">{groups.length === 0
          ? "No active groups available to add."
          : "No groups match your search."}</p> : null}
      </div>
      <div className="campaign-group-dialog-footer">
        <span className="card-note" role="status">{validSelection.length} selected</span>
        <div className="campaign-group-actions">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={validSelection.length === 0}
            onClick={() => { add(validSelection); close(); }}>Add selected</button>
        </div>
      </div>
    </dialog>
  );
}

// A campaign change must remount storage state, even when a caller reuses this component.
export function CampaignGroups(props: Props) {
  return <CampaignGroupEditor key={props.slug} {...props} />;
}

function CampaignGroupEditor({ slug, liveGroups, knownGroups, variantCount }: Props) {
  const id = useId();
  const key = groupDraftKey(slug);
  const [draft, setDraft] = useState<CampaignGroupDraft | null>(null);
  const [open, setOpen] = useState(false);
  const [removeJid, setRemoveJid] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let initial = emptyGroupDraft();
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        try { initial = parseGroupDraft(raw); }
        catch { setNotice("The saved group draft could not be read. Showing the latest live groups instead."); }
      }
    } catch {
      setStorageFailed(true);
    }
    setDraft(initial);
  }, [key]);

  useEffect(() => {
    // Never write the initial empty state before the browser draft has loaded.
    if (draft === null) return;
    const result = reconcileGroupDraft(draft, liveGroups, knownGroups);
    if (result.draft !== draft) setDraft(result.draft);
    if (result.droppedAdditions > 0) {
      setNotice(`${plural(result.droppedAdditions, "draft addition")} removed because the groups are no longer known or active.`);
    }
    try {
      if (hasGroupDraft(result.draft)) window.localStorage.setItem(key, JSON.stringify(result.draft));
      else window.localStorage.removeItem(key);
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [draft, key, liveGroups, knownGroups]);

  const current = draft ? reconcileGroupDraft(draft, liveGroups, knownGroups).draft : emptyGroupDraft();
  const removed = new Set(current.removed);
  const paused = new Set(current.paused);
  const knownById = new Map(knownGroups.map((group) => [group.jid, group]));
  const rows: { group: CampaignGroupRow | KnownCampaignGroup; live: CampaignGroupRow | null }[] =
    liveGroups.filter((group) => !removed.has(group.jid)).map((group) => ({ group, live: group }));
  for (const jid of current.added) {
    const group = knownById.get(jid);
    if (group) rows.push({ group, live: null });
  }
  const assigned = new Set(rows.map(({ group }) => group.jid));
  const available = knownGroups.filter((group) => group.status === "active" && !assigned.has(group.jid));
  const removalRow = rows.find(({ group }) => group.jid === removeJid);
  const removalAvailable = removalRow !== undefined;

  useEffect(() => {
    // A refreshed target list can remove the row while its warning is open.
    if (!removalAvailable) setRemoveJid(null);
  }, [removalAvailable]);

  function change(next: CampaignGroupDraft) {
    setDraft(next);
    setNotice(null);
  }

  function add(jids: string[]) {
    const liveIds = new Set(liveGroups.map((group) => group.jid));
    change({
      ...current,
      added: [...new Set([...current.added, ...jids.filter((jid) => !liveIds.has(jid))])],
      removed: current.removed.filter((jid) => !jids.includes(jid)),
    });
  }

  return (
    <section className="card campaign-groups" aria-labelledby={`${id}-title`}>
      <div className="card-head">
        <div>
          <h2 className="card-title" id={`${id}-title`}>Where it goes</h2>
          <p className="card-note campaign-group-help">Changes are saved in this browser only and do not affect the bot.</p>
        </div>
        <div className="campaign-group-actions">
          <button type="button" className="btn" disabled={draft === null || !hasGroupDraft(current)}
            onClick={() => change(emptyGroupDraft())}>Reset draft</button>
          <button ref={addButton} type="button" className="btn campaign-group-add" disabled={draft === null} onClick={() => setOpen(true)}>
            <Plus size={16} aria-hidden /> Add groups
          </button>
        </div>
      </div>
      <div className="campaign-group-feedback">
        <p className="card-note">{plural(rows.length, "group")} in draft · {rows.length - paused.size} participating · {paused.size} paused
          <span className="campaign-group-deltas">{current.added.length} added · {current.removed.length} removed</span>
        </p>
        <p className="card-note" role="status">{draft === null ? "Loading browser draft…" : storageFailed
          ? "Browser storage is unavailable. Edits are kept on this page only; reloading may restore an older draft."
          : hasGroupDraft(current) ? "Draft saved in this browser. Pause applies only to this campaign." : "No local changes. Pause applies only to this campaign."}</p>
        {notice ? <p className="card-note" role="status">{notice}</p> : null}
      </div>
      <div className="table-wrap" role="region" aria-label="Campaign groups, scroll horizontally for actions" tabIndex={0}>
        <table className="data">
          <thead><tr>
            <th scope="col">Group</th><th scope="col">Today (live)</th><th scope="col">Ref</th><th scope="col">Variant</th>
            <th scope="col">Line</th><th scope="col">Replies to</th><th scope="col">Cadence</th><th scope="col">Actions</th>
          </tr></thead>
          <tbody>
            {rows.map(({ group, live }) => (
              <tr key={group.jid}>
                <td>
                  <div className="cell-strong">{groupLabel(group)}</div>
                  <div className="cell-mono">{shortJid(group.jid)}</div>
                  {!live ? <span className="pill pill-info campaign-group-draft-badge">Draft addition</span> : null}
                </td>
                <td>{paused.has(group.jid) ? <span className="pill pill-warning">Paused · draft</span>
                  : !live ? <span className="cell-muted">—</span>
                    : live.sendsToday ? <span className="pill pill-success">Posts</span>
                      : <span className="pill pill-warning" title={`today goes to ${live.allowedToday.join(", ")}`}>At cap</span>}</td>
                <td className="cell-mono">{live?.ref ?? "—"}</td>
                <td className="cell-muted">{live?.variant == null ? "—" : `${live.variant + 1}/${variantCount}`}</td>
                <td className="cell-muted">{group.account}</td>
                <td className="cell-mono">{live?.contactNumber ?? "—"}</td>
                <td className="cell-muted">{!live ? "daily (draft)" : live.weekly.length > 0 ? live.weekly.join(", ") : "daily"}</td>
                <td className="cell-actions">
                  <div className="campaign-group-row-actions">
                    <button type="button" className="btn campaign-group-toggle" disabled={draft === null}
                      aria-label={`${paused.has(group.jid) ? "Resume" : "Pause"} ${groupLabel(group)} in this campaign`}
                      onClick={() => change({ ...current, paused: paused.has(group.jid)
                        ? current.paused.filter((jid) => jid !== group.jid) : [...current.paused, group.jid] })}>
                      {paused.has(group.jid) ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
                      {paused.has(group.jid) ? "Resume" : "Pause"}
                    </button>
                    <button type="button" className="row-action row-action-danger" disabled={draft === null}
                      aria-label={`Remove ${groupLabel(group)} from campaign`} title="Remove from campaign draft"
                      onClick={() => setRemoveJid(group.jid)}><Trash2 size={16} aria-hidden /></button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={8}><div className="empty">No groups in this draft. Add groups to get started.</div></td></tr> : null}
          </tbody>
        </table>
      </div>
      {open ? <AddGroupsDialog groups={available} close={() => setOpen(false)} add={add} /> : null}
      {removalRow ? <RemoveGroupDialog group={removalRow.group} close={() => setRemoveJid(null)}
        fallbackFocus={addButton} confirm={() => {
          const jid = removalRow.group.jid;
          change({
            ...current,
            added: current.added.filter((entry) => entry !== jid),
            removed: removalRow.live ? [...current.removed, jid] : current.removed,
            paused: current.paused.filter((entry) => entry !== jid),
          });
          setRemoveJid(null);
        }} /> : null}
    </section>
  );
}
