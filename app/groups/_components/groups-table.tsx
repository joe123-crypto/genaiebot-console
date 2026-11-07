"use client";

import { useEffect, useId, useRef, useState } from "react";
import { STATUS_LABEL, StatusPill } from "@/app/_components/ui";
import { DeleteGroup } from "@/app/groups/_components/delete-group";
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
  type FacetOption,
  type GroupFilter,
  type GroupView,
} from "@/src/domains/group-filter";
import { campaignTitle, confirmLabel, groupLabel, plural, shortJid } from "@/src/lib/format";
import type { Group, GroupStatus } from "@/src/lib/types";

type Props = {
  /** Every group on record. The table narrows them; it never refetches. */
  groups: Group[];
  disabledPromos: string[];
  /** `WRITES_ENABLED` reads an unprefixed environment variable, so it is false
   *  in a browser bundle. The server page has to hand it over. */
  writesEnabled: boolean;
  /** Read from the URL on the server, and used only to seed the state below. */
  initialFilter: GroupFilter;
};

const VIEWS: GroupView[] = ["all", "needs-decision", "advertising", "no-campaign"];
const STATUSES: GroupStatus[] = ["active", "on-hold", "admin-only", "not-a-member"];

/** Long enough that a fast typist writes one history entry rather than twenty:
 *  Safari and Firefox throttle `replaceState` at around a hundred calls per
 *  thirty seconds. The table itself never waits for this — it filters from
 *  state as the key goes down. */
const URL_SYNC_MS = 250;

function Facet({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: FacetOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="filter-field">
      <label className="filter-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={options.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function GroupsTable({ groups, disabledPromos, writesEnabled, initialFilter }: Props) {
  const id = useId();
  // Seeded once, deliberately. AutoRefresh re-renders the server page every 60
  // seconds and sends a fresh `initialFilter`; syncing it back into state would
  // reset the box an operator is halfway through typing into.
  const [filter, setFilter] = useState<GroupFilter>(initialFilter);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      // Start from the live query string so a parameter this table knows
      // nothing about survives being filtered.
      const next = new URLSearchParams(window.location.search);
      for (const key of GROUP_FILTER_KEYS) next.delete(key);
      for (const [key, value] of groupFilterQuery(filter)) next.set(key, value);
      const query = next.toString();
      const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
      // Next patches replaceState, so this updates the URL without refetching
      // the page. The guard keeps a no-op render from writing history at all.
      if (url !== `${window.location.pathname}${window.location.search}`) {
        window.history.replaceState(null, "", url);
      }
    }, URL_SYNC_MS);
    return () => clearTimeout(timer);
  }, [filter]);

  const off = new Set(disabledPromos);
  const visible = sortGroupsForTable(filterGroups(groups, filter));
  const columns = writesEnabled ? 8 : 7;
  const unfiltered = isDefaultGroupFilter(filter);

  function set(key: keyof GroupFilter, value: string) {
    setFilter((current) => ({ ...current, [key]: value }));
  }

  function clear() {
    setFilter(DEFAULT_GROUP_FILTER);
    // The button disables itself on this click, and a disabled element drops
    // focus to the body, which strands anyone navigating by keyboard.
    search.current?.focus();
  }

  return (
    <div className="card">
      <div className="filter-bar" role="search" aria-label="Filter groups">
        <div className="filter-field filter-field-search">
          <label className="filter-label" htmlFor={`${id}-q`}>
            Search by group name or ID
          </label>
          <input
            ref={search}
            id={`${id}-q`}
            type="search"
            value={filter.q}
            placeholder="Search groups…"
            onChange={(event) => set("q", event.target.value)}
          />
        </div>

        <div className="filter-field">
          <label className="filter-label" htmlFor={`${id}-status`}>
            Status
          </label>
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
        </div>

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

        <div className="filter-actions">
          <button type="button" className="btn" onClick={clear} disabled={unfiltered}>
            Clear filters
          </button>
        </div>
      </div>

      <div className="filter-summary">
        <p className="card-note" role="status" aria-atomic="true">
          {unfiltered
            ? `Showing all ${plural(groups.length, "group")}`
            : `Showing ${visible.length} of ${plural(groups.length, "group")}`}
        </p>
        <p className="card-note">
          Groups needing a decision are listed first. A group the bot cannot post in returns{" "}
          <code>forbidden</code> at send time; one it has left returns <code>item-not-found</code>.
          Highlighted campaigns are the ones today&apos;s rotation gives the group&apos;s allowance
          to.
        </p>
      </div>

      <div
        className="table-wrap"
        role="region"
        aria-label="Groups, scroll horizontally for actions"
        tabIndex={0}
      >
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Status</th>
              <th scope="col">Line</th>
              <th scope="col">Tier</th>
              <th scope="col">Cap today</th>
              <th scope="col">Campaigns</th>
              <th scope="col">Note</th>
              {writesEnabled ? (
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => (
              <tr key={group.jid}>
                <td>
                  <div className="cell-strong">{groupLabel(group)}</div>
                  <div className="cell-mono">{shortJid(group.jid)}</div>
                </td>
                <td>
                  <StatusPill status={group.status} />
                </td>
                <td className="cell-muted">{group.account}</td>
                <td className="cell-muted">{group.activity}</td>
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
                  {group.promos.length === 0 ? (
                    <span className="cell-muted">none</span>
                  ) : (
                    <div className="tag-row">
                      {group.promos.map((promo) => {
                        const isOff = off.has(promo);
                        const sendsToday = !isOff && group.allowedToday.includes(promo);
                        const weekly = group.weekly[promo];
                        return (
                          <span
                            key={promo}
                            className={`tag${isOff ? " tag-off" : sendsToday ? " tag-on" : ""}`}
                            title={
                              isOff
                                ? "campaign is switched off — it installs no cron and never posts"
                                : weekly
                                  ? `only on ${weekly.join(", ")}`
                                  : sendsToday
                                    ? "posts today"
                                    : "held back by today's cap"
                            }
                          >
                            {campaignTitle(promo)}
                            {weekly ? ` · ${weekly.join("/")}` : ""}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="cell-note" title={group.note ?? undefined}>{group.note ?? ""}</td>
                {writesEnabled ? (
                  <td className="cell-actions">
                    <DeleteGroup jid={group.jid} label={confirmLabel(group)} />
                  </td>
                ) : null}
              </tr>
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
