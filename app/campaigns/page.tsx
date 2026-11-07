import Link from "next/link";
import { Repeat2 } from "lucide-react";
import { CampaignThumb } from "@/app/campaigns/_components/campaign-images";
import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, Empty, PageHead } from "@/app/_components/ui";
import { BotUnavailableError, getCampaigns } from "@/src/lib/bot-client";
import { campaignTitle, plural, slotLabel } from "@/src/lib/format";
import type { Campaign } from "@/src/lib/types";

export const dynamic = "force-dynamic";

/** Saying only "10 campaigns" would present a switched-off one as if it runs. */
function subtitle(campaigns: Campaign[]) {
  const off = campaigns.filter((campaign) => !campaign.enabled).length;
  const all = `${plural(campaigns.length, "campaign")}, in the order they run through the day.`;
  return off === 0 ? all : `${all} ${off} switched off and never posting.`;
}

export default async function CampaignsPage() {
  let campaigns: Campaign[];
  try {
    campaigns = await getCampaigns();
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return (
      <Shell>
        <PageHead title="Campaigns" />
        <BotError detail={error.detail} />
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHead
        title="Campaigns"
        subtitle={subtitle(campaigns)}
      />

      {campaigns.length === 0 ? (
        <Empty>No campaigns are declared.</Empty>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Campaign</th>
                  <th>Reach</th>
                  <th>Line</th>
                  <th>Ref</th>
                  <th>Copy</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.slug} className="campaign-preview-row">
                    <td
                      className="cell-strong"
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        ...(campaign.enabled
                          ? {}
                          : { textDecoration: "line-through", opacity: 0.6 }),
                      }}
                      title={campaign.enabled ? undefined : "no cron is installed for this slot"}
                    >
                      {slotLabel(campaign)}
                    </td>
                    <td>
                      <div className="cell-strong">
                        <Link
                          className="campaign-preview-link"
                          href={`/campaigns/${campaign.slug}`}
                          aria-label={`Preview ${campaignTitle(campaign.slug)}`}
                        >
                          {campaignTitle(campaign.slug)}
                        </Link>
                      </div>
                      <div className="cell-mono">{campaign.name}</div>
                      {campaign.enabled ? null : (
                        <div
                          className="pill pill-warning"
                          style={{ marginTop: 4 }}
                          title={'enabled is false in deploy/promo-crons.json'}
                        >
                          switched off
                        </div>
                      )}
                      {campaign.error ? (
                        <div className="pill pill-danger" style={{ marginTop: 4 }}>
                          {campaign.error}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="cell-strong">{campaign.targetCount}</span>{" "}
                      <span className="cell-muted">groups</span>
                      {campaign.weeklyCount > 0 ? (
                        <div className="pill" style={{ marginTop: 4 }}>
                          {campaign.weeklyCount} weekly only
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="tag-row">
                        {Object.entries(campaign.accounts).map(([account, count]) => (
                          <span key={account} className="tag">
                            {account} · {count}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {campaign.tracking.prefix ? (
                        <span className="pill pill-info">{campaign.tracking.prefix}</span>
                      ) : (
                        <span className="cell-muted">none</span>
                      )}
                      {campaign.tracking.number ? (
                        <div className="cell-mono" style={{ marginTop: 4 }}>
                          {campaign.tracking.number}
                        </div>
                      ) : null}
                    </td>
                    <td className="cell-muted">
                      <div className="campaign-copy-cell">
                        {/* Decorative: the counts beside it say the same thing
                            as text, for anything that cannot see the picture. */}
                        <CampaignThumb slug={campaign.slug} images={campaign.images} />
                        <span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <Repeat2 size={14} aria-hidden />
                            {plural(campaign.captions.length, "variant")}
                          </span>
                          <br />
                          {plural(campaign.images.length, "image")}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
