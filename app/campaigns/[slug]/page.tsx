import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, PageHead, Stat } from "@/app/_components/ui";
import {
  BotUnavailableError,
  captionSaveUnavailableReason,
  getCampaignPreview,
  getCampaigns,
  getGroups,
  imageWritesUnavailableReason,
} from "@/src/lib/bot-client";
import { CampaignImages } from "@/app/campaigns/_components/campaign-images";
import { CampaignGroups } from "@/app/campaigns/_components/campaign-groups";
import { CampaignSwitch } from "@/app/campaigns/_components/campaign-switch";
import { CaptionVariants } from "@/app/campaigns/_components/caption-variants";
import { campaignAssetDir } from "@/src/lib/campaign-images";
import { loadOverview } from "@/src/domains/console";
import { WRITES_ENABLED } from "@/src/config";
import { canWrite } from "@/src/lib/write-capabilities";
import { campaignOffLabel, campaignTitle, groupLabel, slotLabel } from "@/src/lib/format";
import type { Campaign, CampaignPreview, GroupsPayload } from "@/src/lib/types";

export const dynamic = "force-dynamic";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let preview: CampaignPreview;
  let campaign: Campaign | undefined;
  let membership: GroupsPayload;
  try {
    [preview, campaign, membership] = await Promise.all([
      getCampaignPreview(slug),
      getCampaigns().then((all) => all.find((entry) => entry.slug === slug)),
      getGroups(),
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

  // What the bot will accept. Already read for this request by the layout, so
  // this costs nothing; if the overview could not be read, nothing is offered.
  const loaded = await loadOverview();
  const writes = loaded.ok ? loaded.overview.writes : undefined;

  const sendingToday = preview.groups.filter((row) => row.sendsToday);
  // Paused rows are listed so they can be resumed, but no cap is holding them.
  const pausedRows = preview.groups.filter((row) => row.paused).length;
  const heldBack = preview.groups.length - sendingToday.length - pausedRows;
  // Moving a group in or out touches all three: a removal also clears the
  // group's pause and cadence for this campaign.
  const groupsGate = WRITES_ENABLED
    ? canWrite(WRITES_ENABLED, writes, "groups", "promos", "paused_promos", "weekly")
    : undefined;
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
            : `Not posting (${campaignOffLabel(campaign)}) — would run at ${slotLabel(campaign)} ${campaign.timezone} · ${campaign.name}`
        }
        actions={
          <Link className="link" href="/campaigns">
            All campaigns
          </Link>
        }
      />

      {WRITES_ENABLED ? (
        <CampaignSwitch
          slug={slug}
          title={campaignTitle(slug)}
          // An older bot reports only the combined switch; editing it then is
          // refused by the gate anyway, so the fallback only decides the label.
          storeEnabled={campaign.storeEnabled ?? campaign.enabled}
          cronEnabled={campaign.cronEnabled}
          gate={canWrite(WRITES_ENABLED, writes, "campaigns", "enabled")}
        />
      ) : null}

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <Stat label="Groups targeted" value={campaign.targetCount} />
        <Stat
          label="Posting today"
          value={sendingToday.length}
          note={`${heldBack} held back by caps${pausedRows > 0 ? ` · ${pausedRows} paused` : ""}`}
        />
        <Stat label="Caption variants" value={preview.captions.length} />
        <Stat
          label="Ref prefix"
          value={preview.tracking.prefix ?? "—"}
          note={preview.tracking.label}
        />
      </div>

      <p className="card-note campaign-live-stats-note">Statistics above show live configuration and leave out changes not yet applied.</p>

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
        saveUnavailableReason={captionSaveUnavailableReason(writes)}
        samples={samples.map((sample) => sample ? {
          label: groupLabel(sample), ref: sample.ref, caption: sample.caption,
        } : null)}
      />

      <CampaignGroups
        slug={slug}
        liveGroups={preview.groups.map(({ caption, cap, ...row }) => row)}
        knownGroups={membership.groups.map(({ jid, name, account, status }) => ({ jid, name, account, status }))}
        variantCount={preview.captions.length}
        gate={groupsGate}
      />
    </Shell>
  );
}
