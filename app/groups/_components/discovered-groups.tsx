import { Empty } from "@/app/_components/ui";
import { ADD_EXPLAINER, AddDiscoveredGroup } from "@/app/groups/_components/add-discovered-group";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { DiscoveredGroup, GroupDiscovery } from "@/src/lib/types";
import { DmcHeading, DmcValue, MemberValue } from "@/app/groups/_components/group-metrics";

function observedAt(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "Unknown";
}

/** Server-rendered inventory; these rows are deliberately outside ad settings
 *  until an operator adds one -- which puts it on record in no campaign. The
 *  Add column appears only when the console's writes are switched on. */
export function DiscoveredGroups({ groups, discovery, addGate }: {
  groups?: DiscoveredGroup[];
  discovery?: GroupDiscovery;
  addGate?: WriteGate;
}) {
  if (groups === undefined && discovery === undefined) return null;
  const rows = groups ?? [];
  return (
    <section className="card" style={{ marginBottom: 16 }} aria-labelledby="unassigned-groups-title">
      <div className="card-head">
        <h2 className="card-title" id="unassigned-groups-title">Unassigned <span className="pill">{rows.length}</span></h2>
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
              {account.lastSuccessAt ? <> Last successful scan: <time dateTime={account.lastSuccessAt}>{observedAt(account.lastSuccessAt)}</time>.</> : null}
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
                {addGate ? <th><span className="visually-hidden">Actions</span></th> : null}
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
                  <td><MemberValue metrics={group.metrics} /></td>
                  <td className="cell-muted"><time dateTime={group.lastSeenAt}>{observedAt(group.lastSeenAt)}</time></td>
                  {addGate ? (
                    <td className="cell-actions">
                      <AddDiscoveredGroup jid={group.jid} label={group.name || group.jid} gate={addGate} />
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
