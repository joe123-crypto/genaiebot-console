"use client";

import { Fragment, useId, useRef, useState } from "react";
import {
  Facet, FilterActions, FilterBar, FilterField, FilterSearch, FilterSummary, useUrlFilter,
} from "@/app/_components/filter-bar";
import { STATUS_LABEL, StatusPill } from "@/app/_components/ui";
import { DeleteGroup } from "@/app/groups/_components/delete-group";
import { EditGroup } from "@/app/groups/_components/edit-group";
import { AddGroupCampaign, type GroupCampaignOption } from "@/app/groups/_components/add-group-campaign";
import { DmcHeading, DmcValue, GroupDetails, MemberValue } from "@/app/groups/_components/group-metrics";
import { READ_ONLY_REASON, type WriteGate } from "@/src/lib/write-capabilities";
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
import { campaignTitle, confirmLabel, groupLabel, shortJid } from "@/src/lib/format";
import type { Group, GroupStatus } from "@/src/lib/types";

/** What the row actions may do, worked out on the server from the console's
 *  switch and the bot's own report, and the vocabulary the Edit form offers. */
export type GroupEditing = {
  edit: WriteGate;
  /** The Edit dialog's fields the bot accepts; the rest show, disabled. */
  editableFields: string[];
  delete: WriteGate;
  lines: string[];
  tiers: string[];
};

/** Nothing armed. Used when a caller passes no gates, so forgetting them can
 *  only ever make the table more read-only, never less. */
const NO_EDITING: GroupEditing = {
  edit: { allowed: false, reason: READ_ONLY_REASON },
  editableFields: [],
  delete: { allowed: false, reason: READ_ONLY_REASON },
  lines: [],
  tiers: [],
};

const NO_CAMPAIGNS: GroupCampaignOption[] = [];
const NO_CAMPAIGN_WRITES: WriteGate = { allowed: false, reason: READ_ONLY_REASON };

type Props = {
  /** Every group on record. The table narrows them; it never refetches. */
  groups: Group[];
  disabledPromos: string[];
  /** `WRITES_ENABLED` reads an unprefixed environment variable, so it is false
   *  in a browser bundle. The server page has to hand it over. */
  writesEnabled: boolean;
  editing?: GroupEditing;
  campaigns?: GroupCampaignOption[];
  campaignGate?: WriteGate;
  /** Read from the URL on the server, and used only to seed the state below. */
  initialFilter: GroupFilter;
};

const VIEWS: GroupView[] = ["all", "needs-decision", "advertising", "no-campaign"];
const STATUSES: GroupStatus[] = ["active", "on-hold", "admin-only", "not-a-member"];

export function GroupsTable({
  groups, disabledPromos, writesEnabled, editing = NO_EDITING, initialFilter,
  campaigns = NO_CAMPAIGNS, campaignGate = NO_CAMPAIGN_WRITES,
}: Props) {
  const id = useId();
  // The hook decides which incoming filters are news: a link navigated to
  // while already here is applied, the sixty-second refresh is not.
  const [filter, setFilter] = useUrlFilter(initialFilter, groupFilterQuery, GROUP_FILTER_KEYS);
  const search = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const off = new Set(disabledPromos);
  const visible = sortGroupsForTable(filterGroups(groups, filter));
  const columns = writesEnabled ? 10 : 9;
  const unfiltered = isDefaultGroupFilter(filter);

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
          options={lineOptions(groups, filter.line)}
          onChange={(value) => set("line", value)}
        />
        <Facet
          id={`${id}-campaign`}
          label="Campaign"
          value={filter.campaign}
          options={campaignOptions(groups, disabledPromos, filter.campaign)}
          onChange={(value) => set("campaign", value)}
        />
        <Facet
          id={`${id}-tier`}
          label="Tier"
          value={filter.tier}
          options={tierOptions(groups, filter.tier)}
          onChange={(value) => set("tier", value)}
        />

        <FilterActions>
          <button type="button" className="btn" onClick={clear} disabled={unfiltered}>
            Clear filters
          </button>
        </FilterActions>
      </FilterBar>

      <FilterSummary
        shown={visible.length}
        total={groups.length}
        noun="group"
        unfiltered={unfiltered}
      >
        <p className="card-note">
          Groups needing a decision are listed first. A group the bot cannot post in returns{" "}
          <code>forbidden</code> at send time; one it has left returns <code>item-not-found</code>.
          Highlighted campaigns are the ones today&apos;s rotation gives the group&apos;s allowance
          to.
        </p>
      </FilterSummary>

      <div
        className="table-wrap groups-table-wrap"
        role="region"
        aria-label="Groups, scroll horizontally for counts and actions"
        tabIndex={0}
      >
        <table className="data">
          <thead>
            <tr>
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
                <tr>
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
                  <td><MemberValue metrics={group.metrics} /></td>
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
                        const weekly = group.weekly[promo];
                        return (
                          <span
                            key={promo}
                            className={`tag${isOff || isPaused ? " tag-off" : sendsToday ? " tag-on" : ""}`}
                            title={
                              isOff
                                ? "campaign is switched off — it posts nowhere"
                                : isPaused
                                  ? "paused for this group — still assigned, but nothing is sent"
                                  : weekly
                                    ? `only on ${weekly.join(", ")}`
                                    : sendsToday
                                      ? "posts today"
                                      : "held back by today's cap"
                            }
                          >
                            {campaignTitle(promo)}
                            {weekly ? ` · ${weekly.join("/")}` : ""}
                            {isPaused ? " · paused" : ""}
                          </span>
                        );
                      })}
                      {writesEnabled ? <AddGroupCampaign group={group} campaigns={campaigns} gate={campaignGate} /> : null}
                    </div>
                  </td>
                  <td>
                    <button type="button" className="btn group-more"
                      aria-label={`More about ${confirmLabel(group)}`}
                      aria-expanded={expanded.has(group.jid)}
                      aria-controls={`${id}-details-${group.jid}`}
                      onClick={() => setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(group.jid)) next.delete(group.jid); else next.add(group.jid);
                        return next;
                      })}>
                      More <span aria-hidden="true">{expanded.has(group.jid) ? "▴" : "▾"}</span>
                    </button>
                  </td>
                  {writesEnabled ? (
                    <td className="cell-actions">
                      <EditGroup
                        group={group}
                        label={confirmLabel(group)}
                        lines={editing.lines}
                        tiers={editing.tiers}
                        gate={editing.edit}
                        editable={editing.editableFields}
                      />
                      <DeleteGroup jid={group.jid} label={confirmLabel(group)} gate={editing.delete} />
                    </td>
                  ) : null}
                </tr>
                <tr id={`${id}-details-${group.jid}`} hidden={!expanded.has(group.jid)} className="group-details-row">
                  <td colSpan={columns}><GroupDetails jid={group.jid} note={group.note} metrics={group.metrics} /></td>
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
