import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead, Stat } from "@/app/_components/ui";
import {
  BotUnavailableError,
  getCampaignPreview,
  getCampaigns,
} from "@/src/lib/bot-client";
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
        subtitle={`Runs at ${slotLabel(campaign)} ${campaign.timezone} · ${campaign.name}`}
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2 className="card-title">Caption variants</h2>
          <span className="card-note">
            Exactly as the cron would send them, with that group&apos;s ref code and link
            already substituted.
          </span>
        </div>
        <div className="card-pad grid grid-two">
          {preview.captions.map((_, index) => {
            const sample = samples[index];
            return (
              <div key={index}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 7,
                    alignItems: "center",
                  }}
                >
                  <span className="pill pill-info">Variant {index + 1}</span>
                  {sample ? (
                    <span className="card-note">
                      as sent to {groupLabel(sample)} · {sample.ref}
                    </span>
                  ) : (
                    <span className="card-note">no group gets this variant today</span>
                  )}
                </div>
                <pre className="caption-box">{sample?.caption ?? preview.captions[index]}</pre>
              </div>
            );
          })}
        </div>
      </div>

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
