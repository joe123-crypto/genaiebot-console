"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { Empty } from "@/app/_components/ui";
import { ADD_EXPLAINER, DiscoveredGroupActions } from "@/app/groups/_components/discovered-group-actions";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { DiscoveredGroup, GroupDiscovery } from "@/src/lib/types";
import { DmcHeading, DmcValue, MemberValue } from "@/app/groups/_components/group-metrics";
import { displayStamp } from "@/src/lib/timezone";
import { BOT_TIMEZONE } from "@/src/config";

export function DiscoveredGroups({ groups, discovery, addGate, removeGate, total, pagination, scrollRef, zone = BOT_TIMEZONE }: {
  pagination?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  groups?: DiscoveredGroup[];
  discovery?: GroupDiscovery;
  addGate?: WriteGate;
  removeGate?: WriteGate;
  total?: number;
  zone?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const container = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      if (panel.current) panel.current.style.setProperty("--unassigned-space",
        `${Math.max(0, window.innerHeight - panel.current.getBoundingClientRect().top - 12)}px`);
    };
    const outside = (event: PointerEvent) => {
      // Action dialogs may be portalled outside this panel. Keep their owner mounted.
      if (document.querySelector("dialog[open], [aria-modal='true']")) return;
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      // React may remove a confirmation before this native document listener runs.
      // Its original event target still identifies the dialog that owned Escape.
      const fromDialog = event.target instanceof Element && event.target.closest("dialog, [aria-modal='true']");
      if (event.key !== "Escape" || event.defaultPrevented || fromDialog || document.querySelector("dialog[open], [aria-modal='true']")) return;
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (container.current) observer?.observe(container.current);
    if (container.current?.parentElement) observer?.observe(container.current.parentElement);
    window.addEventListener("resize", measure);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (groups === undefined && discovery === undefined) return null;
  const rows = groups ?? [];
  const showActions = addGate || removeGate;
  return (
    <section ref={container} className="card unassigned-groups" aria-labelledby="unassigned-groups-title"
      onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) &&
          !document.querySelector("dialog[open], [aria-modal='true']")) setOpen(false);
      }}>
      <div className="card-head">
        <h2 className="card-title" id="unassigned-groups-title">
          <button ref={trigger} type="button" className="unassigned-toggle" aria-expanded={open}
            aria-controls={panelId} onClick={() => setOpen(value => !value)}>
            <ChevronDown size={16} aria-hidden="true" className={open ? "is-open" : undefined} />
            Unassigned <span className="pill">{total ?? rows.length}</span>
          </button>
        </h2>
        <span className="card-note">Saved automatically. No campaigns are assigned automatically.</span>
      </div>
      <div id={panelId} ref={element => { panel.current = element; if (scrollRef) scrollRef.current = element; }}
        className="unassigned-panel" hidden={!open} role="region" aria-label="Unassigned groups" tabIndex={0}>
      {discovery ? (
        <div className="card-note" style={{ padding: "0 20px 16px" }}>
          {!discovery.enabled ? <p>Automatic discovery is paused. Saved observations are retained.</p> : null}
          {discovery.accounts.map((account) => (
            <p key={account.accountId}>
              <strong>{account.accountId}</strong>{": "}
              {account.status === "waiting" ? "Waiting for the first scan after this account connects." :
                account.status === "disabled" ? "Discovery paused." :
                  account.status === "error" ? "Discovery unavailable; previous observations are retained." :
                    account.status === "stale" ? "Observations are out of date; the account may be offline or in standby." :
                      "Discovery up to date."}
              {account.lastSuccessAt ? <> Last successful scan: <time dateTime={account.lastSuccessAt}>{displayStamp(account.lastSuccessAt, zone, "Unknown")}</time>.</> : null}
            </p>
          ))}
          <p>Last seen records an observation, not a guarantee that the bot is still a member.</p>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="table-wrap" role="region" aria-label="Unassigned groups, scroll horizontally for counts and actions" tabIndex={0}>
          {addGate ? <p className="card-note" style={{ padding: "0 20px 12px" }}>{ADD_EXPLAINER}</p> : null}
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Group</th><th scope="col">Joined accounts</th><DmcHeading /><th scope="col">Members</th><th scope="col">Last seen</th>
                {showActions ? <th scope="col"><span className="visually-hidden">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((group) => (
                <tr data-live-id={group.jid} key={group.jid}>
                  <td>
                    <div className="cell-strong">{group.name || "Unnamed group"}</div>
                    <div className="cell-mono">{group.jid}</div>
                  </td>
                  <td className="cell-muted">{group.accounts.map((account) => account.accountId).join(", ")}</td>
                  <td><DmcValue metrics={group.metrics} /></td>
                  <td><MemberValue metrics={group.metrics} zone={zone} /></td>
                  <td className="cell-muted"><time dateTime={group.lastSeenAt}>{displayStamp(group.lastSeenAt, zone, "Unknown")}</time></td>
                  {showActions ? (
                    <td className="cell-actions">
                      <DiscoveredGroupActions jid={group.jid} label={group.name || group.jid}
                        lastSeenAt={group.lastSeenAt} addGate={addGate} removeGate={removeGate} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>No saved unassigned groups.</Empty>}
      {pagination}
      </div>
    </section>
  );
}
