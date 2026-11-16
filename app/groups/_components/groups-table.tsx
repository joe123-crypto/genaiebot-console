"use client";

import { PaginatedPicker, type PickerChoice } from "@/app/_components/paginated-picker";
import { addGroupCampaignAction, addGroupCampaignsAction, removeGroupCampaignAction } from "@/app/groups/actions";
import { liveFetch, notifyLiveChange, useLivePoll } from "@/app/_components/use-live";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
  Facet, FilterActions, FilterBar, FilterField, FilterSearch, FilterSummary, useUrlFilter,
} from "@/app/_components/filter-bar";
import { STATUS_LABEL, StatusPill } from "@/app/_components/ui";
import { useDisplayTimezone } from "@/app/_components/timezone-context";
import { DeleteGroup } from "@/app/groups/_components/delete-group";
import { EditGroup } from "@/app/groups/_components/edit-group";
import { AddGroupCampaign, type GroupCampaignOption } from "@/app/groups/_components/add-group-campaign";
import { DmcHeading, DmcValue, GroupDetails, MemberValue } from "@/app/groups/_components/group-metrics";
import { READ_ONLY_REASON, type WriteGate } from "@/src/lib/write-capabilities";
import { MAX_GROUPS_PER_ASSIGNMENT } from "@/src/domains/group-edit";
import type { CampaignDays } from "@/src/domains/campaign-days";
import {
  DEFAULT_GROUP_FILTER,
  GROUP_FILTER_KEYS,
  GROUP_VIEW_LABEL,
  campaignOptions,
  filterGroups,
  groupFilterQuery,
  isDefaultGroupFilter,
  lineOptions,
  sortGroupsForTable,
  tierOptions,
  type GroupFilter,
  type GroupView,
} from "@/src/domains/group-filter";
import { campaignTitle, confirmLabel, groupLabel, heldBackLabel, shortJid } from "@/src/lib/format";
import type { Group, GroupStatus } from "@/src/lib/types";

/** What the row actions may do, worked out on the server from the console's
 *  switch and the bot's own report, and the vocabulary the Edit form offers. */
export type GroupEditing = {
  edit: WriteGate;
  /** The Edit dialog's fields the bot accepts; the rest show, disabled. */
  editableFields: string[];
  delete: WriteGate;
  /** Taking the bot out of the WhatsApp group, and forgetting what it stored
   *  about it. Neither writes config, so both are gated apart from `delete`. */
  leave: WriteGate;
  clearRecords: WriteGate;
  lines: string[];
  tiers: string[];
};

/** Nothing armed. Used when a caller passes no gates, so forgetting them can
 *  only ever make the table more read-only, never less. */
const NO_EDITING: GroupEditing = {
  edit: { allowed: false, reason: READ_ONLY_REASON },
  editableFields: [],
  delete: { allowed: false, reason: READ_ONLY_REASON },
  leave: { allowed: false, reason: READ_ONLY_REASON },
  clearRecords: { allowed: false, reason: READ_ONLY_REASON },
  lines: [],
  tiers: [],
};

const NO_CAMPAIGNS: GroupCampaignOption[] = [];
const NO_CAMPAIGN_WRITES: WriteGate = { allowed: false, reason: READ_ONLY_REASON };

/** The posting days the dialog chose, for the campaigns it restricted. An
 *  untouched row sends nothing, which leaves that campaign's days as they are;
 *  a dialog that restricted nothing sends no days at all, so an add stays the
 *  plain `promos` write it has always been. */
function chosenDays(rows: PickerChoice[]): CampaignDays | undefined {
  const days = rows.flatMap((row) => row.weekdays ? [[row.id, row.weekdays] as const] : []);
  return days.length > 0 ? Object.fromEntries(days) : undefined;
}

/** One chip, for the set of removals still in flight. */
function removalKey(jid: string, promo: string) {
  return `${jid}\n${promo}`;
}

type Props = {
  /** Every group on record. The table narrows them; it never refetches. */
  groups: Group[];
  disabledPromos: string[];
  /** Whether a capped group's campaigns take turns. A bot that predates the
   *  switch reports nothing and always rotates, so this defaults to true --
   *  never to the falsy `undefined`. */
  rotates?: boolean;
  /** `WRITES_ENABLED` reads an unprefixed environment variable, so it is false
   *  in a browser bundle. The server page has to hand it over. */
  writesEnabled: boolean;
  editing?: GroupEditing;
  campaigns?: GroupCampaignOption[];
  campaignGate?: WriteGate;
  /** Taking a campaign off a group, which rewrites three fields at once and is
   *  therefore gated apart from adding one. */
  removeGate?: WriteGate;
  /** Choosing the days a campaign posts on, which writes `weekly` alongside
   *  `promos` and so needs the extra field the add gate does not ask for. */
  scheduleGate?: WriteGate;
  /** Read from the URL on the server, and used only to seed the state below. */
  initialFilter: GroupFilter;
  remote?: { onFilter: (filter: GroupFilter) => void; total: number; lines: string[]; campaigns: GroupCampaignOption[]; tiers: string[] };

};

const VIEWS: GroupView[] = ["all", "needs-decision", "advertising", "no-campaign"];
const STATUSES: GroupStatus[] = ["active", "on-hold", "admin-only", "not-a-member"];

export function GroupsTable({
  groups, disabledPromos, rotates = true, writesEnabled, editing = NO_EDITING, initialFilter,
  campaigns = NO_CAMPAIGNS, campaignGate = NO_CAMPAIGN_WRITES,
  removeGate = NO_CAMPAIGN_WRITES, scheduleGate = NO_CAMPAIGN_WRITES, remote,
}: Props) {
  const displayZone = useDisplayTimezone();
  const id = useId();
  // The hook decides which incoming filters are news: a link navigated to
  // while already here is applied, the sixty-second refresh is not.
  const [filter, setFilter] = useUrlFilter(initialFilter, groupFilterQuery, GROUP_FILTER_KEYS);
  const search = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** A delete that landed but could not finish everything asked of it. Held
   *  here rather than in the row, which the delete itself removes. */
  const [incomplete, setIncomplete] =
    useState<{ label: string; warnings: string[] } | null>(null);

  const [campaignGroup, setCampaignGroup] = useState<Group | null>(null);
  /** Chips whose removal has been sent and not yet answered. Nothing here is
   *  optimistic: the chip goes when the refreshed row stops naming it. */
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const [selectedGroups, setSelectedGroups] = useState(() => new Map<string, string>());
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [extraGroups, setExtraGroups] = useState<Record<string, Group>>({});
  const [editorDeleted, setEditorDeleted] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  async function loadGroup(group: Group, edit = false) {
    try {
      const result = await liveFetch<{ group: Group | null }>("group", new URLSearchParams({ ids: group.jid }));
      if (!result.group) { setAssignmentError("This group no longer exists. Any open draft is retained."); return; }
      setExtraGroups(previous => ({ ...previous, [group.jid]: result.group! }));
      if (edit) { setEditorDeleted(false); setEditingGroup(result.group); }
    } catch { setAssignmentError("Group details are unavailable. Your draft is retained."); }
  }
  useLivePoll(async signal => {
    if (!remote || !editingGroup) return;
    try { const result = await liveFetch<{ group: Group | null }>("group", new URLSearchParams({ ids: editingGroup.jid }), signal);
      if (!signal.aborted) setEditorDeleted(result.group === null); } catch { /* Saves still require live validation. */ }
  }, Boolean(remote && editingGroup));
  const filterChanged = remote?.onFilter;
  useEffect(() => { filterChanged?.(filter); }, [filter, filterChanged]);
  const off = new Set(disabledPromos);
  const visible = remote ? groups : sortGroupsForTable(filterGroups(groups, filter));
  const canAssign = writesEnabled && campaignGate.allowed;
  // Removal is offered whatever the group's status: the bot refuses to add an
  // on-hold group to a campaign, but never refuses to take one out.
  const canRemove = writesEnabled && removeGate.allowed;
  const selectionFull = selectedGroups.size >= MAX_GROUPS_PER_ASSIGNMENT;
  const columns = 9 + Number(writesEnabled) + Number(canAssign);
  const unfiltered = isDefaultGroupFilter(filter);

  function selectGroup(group: Group, checked: boolean) {
    setSelectedGroups((current) => {
      if (checked && current.size >= MAX_GROUPS_PER_ASSIGNMENT) return current;
      const next = new Map(current);
      if (checked) next.set(group.jid, groupLabel(group));
      else next.delete(group.jid);
      return next;
    });
  }

  async function removeCampaign(group: Group, promo: string) {
    const key = removalKey(group.jid, promo);
    setRemoving((current) => new Set(current).add(key));
    setAssignmentError(null);
    try {
      const result = await removeGroupCampaignAction(group.jid, promo);
      if (result.ok) notifyLiveChange();
      else setAssignmentError(result.detail);
    } catch {
      setAssignmentError("The removal was not sent, so the campaign is still assigned.");
    } finally {
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function set(key: keyof GroupFilter, value: string) {
    setFilter((current) => ({ ...current, [key]: value }));
  }

  function clear() {
    setFilter(() => DEFAULT_GROUP_FILTER);
    // The button disables itself on this click, and a disabled element drops
    // focus to the body, which strands anyone navigating by keyboard.
    search.current?.focus();
  }

  return (
    <div className="card">
      {editorDeleted && editingGroup ? <p role="alert">This group no longer exists. Your open draft is retained.</p> : null}
      {assignmentError ? <p role="alert">{assignmentError}</p> : null}
      {campaignGroup ? <PaginatedPicker kind="campaigns" exclude={campaignGroup.promos} schedule={{ gate: scheduleGate }}
        close={() => setCampaignGroup(null)} choose={async (rows) => {
          const result = await addGroupCampaignAction(campaignGroup.jid, rows.map((row) => row.id), chosenDays(rows));
          if (result.ok) notifyLiveChange();
          return result;
        }} /> : null}
      {bulkPickerOpen ? <PaginatedPicker kind="campaigns" schedule={{ gate: scheduleGate }}
        close={() => setBulkPickerOpen(false)} choose={async (rows) => {
          const result = await addGroupCampaignsAction([...selectedGroups.keys()], rows.map((row) => row.id), chosenDays(rows));
          if (result.ok) setSelectedGroups(new Map());
          if (result.ok || result.refreshLive) notifyLiveChange();
          return result;
        }}>
        <details className="group-assignment-destinations">
          <summary>Add to {selectedGroups.size} {selectedGroups.size === 1 ? "group" : "groups"}</summary>
          <ul>
            {[...selectedGroups].map(([jid, name]) => (
              <li key={jid}>{name} <span className="cell-mono">{shortJid(jid)}</span></li>
            ))}
          </ul>
        </details>
      </PaginatedPicker> : null}
      {editingGroup ? <EditGroup key={editingGroup.jid} group={editingGroup} label={confirmLabel(editingGroup)}
        lines={editing.lines} tiers={editing.tiers} editable={editing.editableFields} gate={editorDeleted ? { allowed: false, reason: "This group no longer exists. Your draft is retained." } : editing.edit}
        initiallyOpen onDismiss={() => setEditingGroup(null)} /> : null}
      <FilterBar label="Filter groups">
        <FilterSearch
          id={`${id}-q`}
          label="Search by group name or ID"
          value={filter.q}
          placeholder="Search groups…"
          inputRef={search}
          onChange={(value) => set("q", value)}
        />

        <FilterField id={`${id}-status`} label="Status">
          <select
            id={`${id}-status`}
            value={filter.status}
            onChange={(event) => set("status", event.target.value)}
          >
            {/* Each option reads on its own: an optgroup's label is announced
                inconsistently, so "Advertising" cannot rely on "Views". */}
            <optgroup label="Views">
              {VIEWS.map((view) => (
                <option key={view} value={view}>
                  {GROUP_VIEW_LABEL[view]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Status">
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </optgroup>
          </select>
        </FilterField>

        <Facet
          id={`${id}-line`}
          label="Line"
          value={filter.line}
          options={remote ? remote.lines.map(value => ({ value, label: value })) : lineOptions(groups, filter.line)}
          onChange={(value) => set("line", value)}
        />
        <Facet
          id={`${id}-campaign`}
          label="Campaign"
          value={filter.campaign}
          options={remote ? remote.campaigns.map(row => ({ value: row.slug, label: row.name })) : campaignOptions(groups, disabledPromos, filter.campaign)}
          onChange={(value) => set("campaign", value)}
        />
        <Facet
          id={`${id}-tier`}
          label="Tier"
          value={filter.tier}
          options={remote ? remote.tiers.map(value => ({ value, label: value })) : tierOptions(groups, filter.tier)}
          onChange={(value) => set("tier", value)}
        />

        <FilterActions>
          <button type="button" className="btn" onClick={clear} disabled={unfiltered}>
            Clear filters
          </button>
        </FilterActions>
      </FilterBar>

      {incomplete ? (
        /* Deliberately outside the table body. A delete removes its own row, so
           a warning rendered inside that row would unmount with it the moment
           the revalidated groups arrive. */
        <div className="groups-table-notice modal-warning" role="status">
          <p>
            <strong>Deleted {incomplete.label}.</strong> Not everything asked for alongside it
            came off:
          </p>
          <ul>{incomplete.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          <button type="button" className="btn" onClick={() => setIncomplete(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <FilterSummary
        shown={visible.length}
        total={remote?.total ?? groups.length}
        noun="group"
        unfiltered={unfiltered && (!remote || visible.length === remote.total)}
      >
        <p className="card-note">
          Groups needing a decision are listed first. A group the bot cannot post in returns{" "}
          <code>forbidden</code> at send time; one it has left returns <code>item-not-found</code>.
          Highlighted campaigns are the ones today&apos;s rotation gives the group&apos;s allowance
          to; one marked <span className="tag-turn" aria-hidden="true">⟳</span> is waiting its turn
          {rotates
            ? ", and its tooltip says when it next posts"
            : " — but turns are off in Settings, so it keeps waiting"}. A struck-through campaign
          is switched off or paused for the group, and waits for nothing.
        </p>
      </FilterSummary>

      {canAssign ? (
        <div className="group-assignment-controls">
          <span className="card-note" role="status">
            {selectedGroups.size} {selectedGroups.size === 1 ? "group" : "groups"} selected
            {selectionFull ? ` (maximum ${MAX_GROUPS_PER_ASSIGNMENT})` : ""}
          </span>
          <button type="button" className="btn" disabled={selectedGroups.size === 0} onClick={() => {
            setSelectedGroups(new Map());
            search.current?.focus();
          }}>
            Clear selection
          </button>
          <button type="button" className="btn btn-primary" aria-haspopup="dialog"
            disabled={selectedGroups.size === 0} onClick={() => setBulkPickerOpen(true)}>
            Add campaigns
          </button>
        </div>
      ) : null}

      <div
        className="table-wrap groups-table-wrap"
        role="region"
        aria-label="Groups, scroll horizontally for counts and actions"
        tabIndex={0}
      >
        <table className="data">
          <thead>
            <tr>
              {canAssign ? <th scope="col" className="group-selection-cell"><span className="visually-hidden">Select group</span></th> : null}
              <th scope="col">Group</th>
              <th scope="col">Status</th>
              <th scope="col">Line</th>
              <th scope="col">Tier</th>
              <DmcHeading />
              <th scope="col">Members</th>
              <th scope="col">Cap today</th>
              <th scope="col">Campaigns</th>
              <th scope="col">More</th>
              {writesEnabled ? (
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => (
              <Fragment key={group.jid}>
                <tr data-live-id={group.jid}>
                  {canAssign ? (
                    <td className="group-selection-cell">
                      {group.status === "active" || selectedGroups.has(group.jid) ? (
                        <input type="checkbox" aria-label={`Select ${confirmLabel(group)} (${shortJid(group.jid)})`}
                          checked={selectedGroups.has(group.jid)}
                          disabled={selectionFull && !selectedGroups.has(group.jid)}
                          onChange={(event) => selectGroup(group, event.currentTarget.checked)} />
                      ) : null}
                    </td>
                  ) : null}
                  <td>
                    <div className="cell-strong">{groupLabel(group)}</div>
                    <div className="cell-mono">{shortJid(group.jid)}</div>
                  </td>
                  <td>
                    <StatusPill status={group.status} />
                  </td>
                  <td className="cell-muted">{group.account}</td>
                  <td className="cell-muted">{group.activity}</td>
                  <td><DmcValue metrics={group.metrics} /></td>
                  <td><MemberValue metrics={group.metrics} zone={displayZone} /></td>
                  <td>
                    {group.cap === null ? (
                      <span className="cell-muted">—</span>
                    ) : (
                      <>
                        <span className="cell-strong">{group.cap}</span>
                        {group.dailyCapOverride !== null ? (
                          <span className="pill" style={{ marginLeft: 6 }}>fixed</span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td>
                    <div className="tag-row group-campaign-tags">
                      {group.promos.length === 0 ? (
                        <span className="cell-muted">none</span>
                      ) : group.promos.map((promo) => {
                        const isOff = off.has(promo);
                        const isPaused = (group.pausedPromos ?? []).includes(promo);
                        const sendsToday = !isOff && !isPaused && group.allowedToday.includes(promo);
                        // Assigned, switched on, not paused -- just not this
                        // group's turn today. The only one of the three dull
                        // chips that comes back on its own.
                        const isHeld = !isOff && !isPaused && !sendsToday;
                        const weekly = group.weekly[promo];
                        const pending = removing.has(removalKey(group.jid, promo));
                        return (
                          <span
                            key={promo}
                            className={`tag${isOff || isPaused ? " tag-off" : sendsToday ? " tag-on" : isHeld ? " tag-held" : ""}${canRemove ? " tag-removable" : ""}${pending ? " tag-removing" : ""}`}
                            title={
                              isOff
                                ? "campaign is switched off — it posts nowhere"
                                : isPaused
                                  ? "paused for this group — still assigned, but nothing is sent"
                                  : weekly
                                    ? `only on ${weekly.join(", ")}`
                                    : sendsToday
                                      ? "posts today"
                                      : heldBackLabel({
                                          nextDay: group.rotation?.nextDay[promo],
                                          rotates,
                                        })
                            }
                          >
                            {campaignTitle(promo)}
                            {weekly ? ` · ${weekly.join("/")}` : ""}
                            {isPaused ? " · paused" : ""}
                            {/* Says "waiting its turn" without leaning on
                                colour, which is all that separates this chip
                                from a plain one. */}
                            {isHeld ? <span className="tag-turn" aria-hidden="true"> ⟳</span> : null}
                            {canRemove ? (
                              <button
                                type="button"
                                className="tag-remove"
                                disabled={pending}
                                aria-label={`Remove ${campaignTitle(promo)} from ${confirmLabel(group)}`}
                                onClick={() => { void removeCampaign(group, promo); }}
                              >
                                <span aria-hidden="true">×</span>
                              </button>
                            ) : null}
                          </span>
                        );
                      })}
                      {writesEnabled ? remote ? <button type="button" className="row-action"
                        aria-label={`Add campaign to ${confirmLabel(group)}`} aria-haspopup="dialog"
                        disabled={!campaignGate.allowed || group.status !== "active"} onClick={() => setCampaignGroup(group)}>+</button>
                        : <AddGroupCampaign group={group} campaigns={campaigns} gate={campaignGate} /> : null}
                    </div>
                  </td>
                  <td>
                    <button type="button" className="btn group-more"
                      aria-label={`More about ${confirmLabel(group)}`}
                      aria-expanded={expanded.has(group.jid)}
                      aria-controls={`${id}-details-${group.jid}`}
                      onClick={() => { if (remote && !expanded.has(group.jid)) void loadGroup(group);
                        setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(group.jid)) next.delete(group.jid); else next.add(group.jid);
                        return next;
                      }); }}>
                      More <span aria-hidden="true">{expanded.has(group.jid) ? "▴" : "▾"}</span>
                    </button>
                  </td>
                  {writesEnabled ? (
                    <td className="cell-actions">
                      {remote ? <button className="row-action" aria-label={`Edit ${confirmLabel(group)}`} onClick={() => { void loadGroup(group, true); }}>Edit</button> : (
                      <EditGroup
                        group={group}
                        label={confirmLabel(group)}
                        lines={editing.lines}
                        tiers={editing.tiers}
                        gate={editing.edit}
                        editable={editing.editableFields}
                      />
                      )}
                      <DeleteGroup
                        jid={group.jid}
                        label={confirmLabel(group)}
                        account={group.account}
                        onIncomplete={(label, warnings) => setIncomplete({ label, warnings })}
                        gate={editing.delete}
                        leaveGate={editing.leave}
                        clearGate={editing.clearRecords}
                      />
                    </td>
                  ) : null}
                </tr>
                <tr id={`${id}-details-${group.jid}`} hidden={!expanded.has(group.jid)} className="group-details-row">
                  <td colSpan={columns}><GroupDetails jid={group.jid} note={extraGroups[group.jid]?.note ?? group.note} metrics={group.metrics} zone={displayZone} /></td>
                </tr>
              </Fragment>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns}>
                  <div className="empty">
                    {groups.length === 0
                      ? "No groups on record."
                      : "No group matches these filters."}
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
