import { Empty } from "@/app/_components/ui";
import { ADD_EXPLAINER, DiscoveredGroupActions } from "@/app/groups/_components/discovered-group-actions";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { DiscoveredGroup, GroupDiscovery } from "@/src/lib/types";
import { DmcHeading, DmcValue, MemberValue } from "@/app/groups/_components/group-metrics";
import { displayStamp } from "@/src/lib/timezone";
import { BOT_TIMEZONE } from "@/src/config";

export function DiscoveredGroups({ groups, discovery, addGate, removeGate, total, zone = BOT_TIMEZONE }: {
  groups?: DiscoveredGroup[];
  discovery?: GroupDiscovery;
  addGate?: WriteGate;
  removeGate?: WriteGate;
  total?: number;
  zone?: string;
}) {
  if (groups === undefined && discovery === undefined) return null;
  const rows = groups ?? [];
  const showActions = addGate || removeGate;
  return (
    <section className="card" style={{ marginBottom: 16 }} aria-labelledby="unassigned-groups-title">
      <div className="card-head">
        <h2 className="card-title" id="unassigned-groups-title">Unassigned <span className="pill">{total ?? rows.length}</span></h2>
        <span className="card-note">Saved automatically. No campaigns are assigned automatically.</span>
      </div>
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
    </section>
  );
}
