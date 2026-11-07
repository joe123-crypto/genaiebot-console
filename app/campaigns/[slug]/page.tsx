import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead, Stat } from "@/app/_components/ui";
import {
  BotUnavailableError,
  captionSaveUnavailableReason,
  getCampaignPreview,
  getCampaigns,
  imageWritesUnavailableReason,
} from "@/src/lib/bot-client";
import { CampaignImages } from "@/app/campaigns/_components/campaign-images";
import { CaptionVariants } from "@/app/campaigns/_components/caption-variants";
import { campaignAssetDir } from "@/src/lib/campaign-images";
import { WRITES_ENABLED } from "@/src/config";
import { campaignTitle, groupLabel, plural, shortJid, slotLabel } from "@/src/lib/format";
import type { Campaign, CampaignPreview } from "@/src/lib/types";

export const dynamic = "force-dynamic";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let preview: CampaignPreview;
  let campaign: Campaign | undefined;
  try {
    [preview, campaign] = await Promise.all([
      getCampaignPreview(slug),
      getCampaigns().then((all) => all.find((entry) => entry.slug === slug)),
    ]);
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return (
      <Shell>
        <PageHead title={campaignTitle(slug)} />
        <BotError detail={error.detail} />
      </Shell>
    );
  }

  if (!campaign) notFound();

  const sendingToday = preview.groups.filter((row) => row.sendsToday);
  // One group per variant, so the operator sees each caption exactly as it will
  // be sent rather than as a template.
  const samples = preview.captions.map((_, index) =>
    preview.groups.find((row) => row.variant === index),
  );

  return (
    <Shell>
      <PageHead
        title={campaignTitle(slug)}
        subtitle={
          campaign.enabled
            ? `Runs at ${slotLabel(campaign)} ${campaign.timezone} · ${campaign.name}`
            : `Switched off — would run at ${slotLabel(campaign)} ${campaign.timezone} · ${campaign.name}`
        }
        actions={
          <Link className="link" href="/campaigns">
            All campaigns
          </Link>
        }
      />

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <Stat label="Groups targeted" value={campaign.targetCount} />
        <Stat
          label="Posting today"
          value={sendingToday.length}
          note={`${preview.groups.length - sendingToday.length} held back by caps`}
        />
        <Stat label="Caption variants" value={preview.captions.length} />
        <Stat
          label="Ref prefix"
          value={preview.tracking.prefix ?? "—"}
          note={preview.tracking.label}
        />
      </div>

      {/* Picture first: it is the order the post itself has. */}
      <CampaignImages
        key={`${slug}-images`}
        slug={slug}
        images={campaign.images}
        assetDir={campaignAssetDir(campaign.script)}
        writable={WRITES_ENABLED}
        writeUnavailableReason={imageWritesUnavailableReason()}
      />

      <CaptionVariants
        key={slug}
        slug={slug}
        captions={preview.captions}
        writable={WRITES_ENABLED}
        saveUnavailableReason={captionSaveUnavailableReason()}
        samples={samples.map((sample) => sample ? {
          label: groupLabel(sample), ref: sample.ref, caption: sample.caption,
        } : null)}
      />

      <div className="card">
        <div className="card-head">
          <h2 className="card-title">Where it goes</h2>
          <span className="card-note">{plural(preview.groups.length, "group")}</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Group</th>
                <th>Today</th>
                <th>Ref</th>
                <th>Variant</th>
                <th>Line</th>
                <th>Replies to</th>
                <th>Cadence</th>
              </tr>
            </thead>
            <tbody>
              {preview.groups.map((row) => (
                <tr key={row.jid}>
                  <td>
                    <div className="cell-strong">{groupLabel(row)}</div>
                    <div className="cell-mono">{shortJid(row.jid)}</div>
                  </td>
                  <td>
                    {row.sendsToday ? (
                      <span className="pill pill-success">Posts</span>
                    ) : (
                      <span className="pill pill-warning" title={`today goes to ${row.allowedToday.join(", ")}`}>
                        At cap
                      </span>
                    )}
                  </td>
                  <td className="cell-mono">{row.ref ?? "—"}</td>
                  <td className="cell-muted">
                    {row.variant === null ? "—" : `${row.variant + 1}/${preview.captions.length}`}
                  </td>
                  <td className="cell-muted">{row.account}</td>
                  <td className="cell-mono">{row.contactNumber ?? "—"}</td>
                  <td className="cell-muted">
                    {row.weekly.length > 0 ? row.weekly.join(", ") : "daily"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
