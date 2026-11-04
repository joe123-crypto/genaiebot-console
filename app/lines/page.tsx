import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, Empty, PageHead } from "@/app/_components/ui";
import { BotUnavailableError, getGroups } from "@/src/lib/bot-client";
import { loadOverview } from "@/src/domains/console";
import { campaignTitle, plural } from "@/src/lib/format";
import type { Group } from "@/src/lib/types";

export const dynamic = "force-dynamic";

export default async function LinesPage() {
  const result = await loadOverview();
  if (!result.ok) {
    return (
      <Shell>
        <PageHead title="WhatsApp lines" />
        <BotError detail={result.detail} />
      </Shell>
    );
  }

  let groups: Group[];
  try {
    ({ groups } = await getGroups());
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return (
      <Shell>
        <PageHead title="WhatsApp lines" />
        <BotError detail={error.detail} />
      </Shell>
    );
  }

  const { overview } = result;

  return (
    <Shell>
      <PageHead
        title="WhatsApp lines"
        subtitle="Each group is posted to only by the line that is actually a member of it."
      />

      <div className="banner" style={{ borderColor: "var(--warning-border)", background: "var(--warning-soft)", color: "#8c5608" }}>
        <span>
          Connection status, QR re-linking and the enable/disable switch need the console API
          running beside the gateway. This page currently shows what the bot&apos;s own
          configuration says, not what the live sockets are doing.
        </span>
      </div>

      <div className="grid grid-two">
        {overview.accounts.map((account) => {
          const mine = groups.filter((group) => group.account === account.id);
          const active = mine.filter((group) => group.status === "active");
          const campaigns = new Map<string, number>();
          for (const group of active) {
            for (const promo of group.promos) {
              campaigns.set(promo, (campaigns.get(promo) ?? 0) + 1);
            }
          }

          return (
            <div className="card" key={account.id}>
              <div className="card-head">
                <h2 className="card-title">
                  {account.id}
                  {account.isContact ? (
                    <span className="pill pill-info" style={{ marginLeft: 8 }}>
                      replies arrive here
                    </span>
                  ) : null}
                </h2>
                <span className="cell-mono">{account.number}</span>
              </div>
              <div className="card-pad" style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "flex", gap: 24 }}>
                  <span>
                    <div className="stat-label">Groups</div>
                    <div className="stat-value" style={{ fontSize: 22 }}>{mine.length}</div>
                  </span>
                  <span>
                    <div className="stat-label">Advertising</div>
                    <div className="stat-value" style={{ fontSize: 22 }}>{active.length}</div>
                  </span>
                  <span>
                    <div className="stat-label">Campaigns</div>
                    <div className="stat-value" style={{ fontSize: 22 }}>{campaigns.size}</div>
                  </span>
                </div>

                {campaigns.size > 0 ? (
                  <div className="tag-row">
                    {[...campaigns.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([promo, count]) => (
                        <span className="tag" key={promo}>
                          {campaignTitle(promo)} · {count}
                        </span>
                      ))}
                  </div>
                ) : (
                  <Empty>This line advertises nothing.</Empty>
                )}

                <p className="card-note" style={{ margin: 0 }}>
                  {plural(active.length, "group")} receive ads from this line.
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
