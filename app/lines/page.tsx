import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, Empty, PageHead } from "@/app/_components/ui";
import { BotUnavailableError, getGroups } from "@/src/lib/bot-client";
import { lineSummaries, loadOverview } from "@/src/domains/console";
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
  let disabledPromos: string[];
  try {
    ({ groups, disabledPromos } = await getGroups());
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return (
      <Shell>
        <PageHead title="WhatsApp lines" />
        <BotError detail={error.detail} />
      </Shell>
    );
  }

  const lines = lineSummaries(result.overview, groups, disabledPromos);

  return (
    <Shell>
      <PageHead
        title="WhatsApp lines"
        subtitle="Each group is posted to only by the line that is actually a member of it."
      />

      <div className="banner" style={{ borderColor: "var(--warning-border)", background: "var(--warning-soft)", color: "#8c5608" }}>
        <span>
          This page shows how the lines are configured, not what the live sockets are
          doing. The read API beside the gateway reads config and never opens a socket,
          so connection status needs a gateway read it deliberately does not do; QR
          re-linking and the enable/disable switch need write routes, which do not exist
          yet.
        </span>
      </div>

      <div className="grid grid-two">
        {lines.map((line) => (
          <div className="card" key={line.id}>
            <div className="card-head">
              <h2 className="card-title">
                {line.id}
                {line.isContact ? (
                  <span className="pill pill-info" style={{ marginLeft: 8 }}>
                    replies arrive here
                  </span>
                ) : null}
              </h2>
              <span className="cell-mono">{line.number}</span>
            </div>
            <div className="card-pad" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "flex", gap: 24 }}>
                <span>
                  <div className="stat-label">Groups</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{line.groupCount}</div>
                </span>
                <span>
                  <div className="stat-label">Advertising</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{line.advertisingCount}</div>
                </span>
                <span>
                  <div className="stat-label">Campaigns</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>{line.campaignCount}</div>
                </span>
              </div>

              {line.promos.length > 0 ? (
                <div className="tag-row">
                  {line.promos.map((promo) => (
                    <span
                      className={`tag${promo.off ? " tag-off" : ""}`}
                      key={promo.slug}
                      title={
                        promo.off
                          ? "campaign is switched off — it installs no cron and never posts"
                          : undefined
                      }
                    >
                      {campaignTitle(promo.slug)} · {promo.count}
                    </span>
                  ))}
                </div>
              ) : (
                <Empty>This line advertises nothing.</Empty>
              )}

              <p className="card-note" style={{ margin: 0 }}>
                {plural(line.advertisingCount, "group")} receive ads from this line.
              </p>
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
