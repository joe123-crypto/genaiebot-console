import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, Empty, PageHead, StatusPill } from "@/app/_components/ui";
import { BotUnavailableError, getGroups } from "@/src/lib/bot-client";
import { needsDecision } from "@/src/domains/console";
import { campaignTitle, confirmLabel, groupLabel, plural, shortJid } from "@/src/lib/format";
import { WRITES_ENABLED } from "@/src/config";
import { DeleteGroup } from "@/app/groups/_components/delete-group";
import type { Group } from "@/src/lib/types";

export const dynamic = "force-dynamic";

function GroupRows({ groups, off }: { groups: Group[]; off: Set<string> }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Group</th>
            <th>Status</th>
            <th>Line</th>
            <th>Tier</th>
            <th>Cap today</th>
            <th>Campaigns</th>
            <th>Note</th>
            {WRITES_ENABLED ? (
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
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
              {WRITES_ENABLED ? (
                <td className="cell-actions">
                  <DeleteGroup jid={group.jid} label={confirmLabel(group)} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function GroupsPage() {
  let groups: Group[];
  let disabledPromos: string[];
  try {
    ({ groups, disabledPromos } = await getGroups());
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return (
      <Shell>
        <PageHead title="Groups" />
        <BotError detail={error.detail} />
      </Shell>
    );
  }

  const off = new Set(disabledPromos);
  const review = groups.filter(needsDecision);
  const advertising = groups.filter((group) => group.status === "active" && group.promos.length > 0);
  const idle = groups.filter((group) => group.status === "active" && group.promos.length === 0);

  return (
    <Shell>
      <PageHead
        title="Groups"
        subtitle={`${plural(groups.length, "group")} on record · ${plural(advertising.length, "advertising")}`}
      />

      {review.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2 className="card-title">Needs a decision</h2>
            <span className="card-note">
              Not advertising. A group the bot cannot post in returns <code>forbidden</code> at
              send time; one it has left returns <code>item-not-found</code>.
            </span>
          </div>
          <GroupRows groups={review} off={off} />
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2 className="card-title">Advertising</h2>
          <span className="card-note">
            Highlighted campaigns are the ones today&apos;s rotation gives the group&apos;s
            allowance to.
          </span>
        </div>
        {advertising.length > 0 ? (
          <GroupRows groups={advertising} off={off} />
        ) : (
          <Empty>No group is advertising right now.</Empty>
        )}
      </div>

      {idle.length > 0 ? (
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Active, in no campaign</h2>
            <span className="card-note">The bot can post here but nothing targets them.</span>
          </div>
          <GroupRows groups={idle} off={off} />
        </div>
      ) : null}
    </Shell>
  );
}
