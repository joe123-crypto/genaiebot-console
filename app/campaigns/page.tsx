import Link from "next/link";
import { Image as ImageIcon, Repeat2 } from "lucide-react";
import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, Empty, PageHead } from "@/app/_components/ui";
import { BotUnavailableError, getCampaigns } from "@/src/lib/bot-client";
import { campaignTitle, plural, slotLabel } from "@/src/lib/format";
import type { Campaign } from "@/src/lib/types";

export const dynamic = "force-dynamic";

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
        subtitle={`${plural(campaigns.length, "campaign")}, in the order they run through the day.`}
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
                  <th />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.slug}>
                    <td className="cell-strong" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {slotLabel(campaign)}
                    </td>
                    <td>
                      <div className="cell-strong">{campaignTitle(campaign.slug)}</div>
                      <div className="cell-mono">{campaign.name}</div>
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
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Repeat2 size={14} aria-hidden />
                        {plural(campaign.captions.length, "variant")}
                      </span>
                      <br />
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <ImageIcon size={14} aria-hidden />
                        {plural(campaign.images.length, "image")}
                      </span>
                    </td>
                    <td>
                      <Link className="link" href={`/campaigns/${campaign.slug}`}>
                        Preview
                      </Link>
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
