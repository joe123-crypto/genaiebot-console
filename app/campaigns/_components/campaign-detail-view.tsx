"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHead, Stat } from "@/app/_components/ui";
import { CampaignGroups } from "@/app/campaigns/_components/campaign-groups";
import { CampaignImages } from "@/app/campaigns/_components/campaign-images";
import { CampaignSwitch } from "@/app/campaigns/_components/campaign-switch";
import { CaptionVariants } from "@/app/campaigns/_components/caption-variants";
import { campaignAssetDir } from "@/src/lib/campaign-images";
import { campaignOffLabel, campaignTitle, groupLabel, slotLabel } from "@/src/lib/format";
import { canWrite, type WriteGate } from "@/src/lib/write-capabilities";
import type { CampaignDetail } from "@/src/domains/campaign-detail";
import type { ReadResource } from "@/src/lib/read-resource";

const UNAVAILABLE_SAVE = "Saving is unavailable until the required campaign data refreshes successfully. Your draft is kept here.";
const NO_GROUPS: [] = [];

/** Adjust this component's state when fresh props arrive, before rendering
 * children. Failed refreshes never replace successful data with empty arrays. */
function useRetainedResource<T>(resource: ReadResource<T>) {
  const [last, setLast] = useState(resource.ok ? resource : null);
  if (resource.ok && resource !== last) setLast(resource);
  return resource.ok ? resource : last;
}

function ReadNotice({ label, resource, lastAt, retry, pending }: {
  label: string;
  resource: ReadResource<unknown>;
  lastAt?: string;
  retry: () => void;
  pending: boolean;
}) {
  if (resource.ok) return null;
  return (
    <div className="campaign-read-notice" role="status">
      <div>
        <strong>{label}: {lastAt ? "Could not refresh" : "Unavailable"}.</strong>{" "}
        {lastAt ? <>Showing out-of-date data, last loaded <time dateTime={lastAt}>{lastAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time>. </> : "This section could not load. "}
        <span>{resource.error.detail}</span>
      </div>
      <button className="btn" type="button" disabled={pending} onClick={retry}
        aria-label={`Retry ${label.toLowerCase()}`}>{pending ? "Retrying…" : "Retry"}</button>
    </div>
  );
}

function UnavailableSection({ title }: { title: string }) {
  return <section className="card card-pad campaign-unavailable"><h2 className="card-title">{title}</h2>
    <p className="card-note">Data is unavailable. Retry to load this section.</p></section>;
}

type Props = {
  slug: string;
  detail: CampaignDetail;
  writable: boolean;
  captionUnavailableReason?: string;
  imageUnavailableReason: string;
};

// Also guard callers that reuse the view when navigating between campaigns.
export function CampaignDetailView(props: Props) {
  return <CampaignDetailContent key={props.slug} {...props} />;
}

function CampaignDetailContent({ slug, detail, writable, captionUnavailableReason, imageUnavailableReason }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const campaignSnapshot = useRetainedResource(detail.campaign);
  const previewSnapshot = useRetainedResource(detail.preview);
  const membershipSnapshot = useRetainedResource(detail.membership);
  const campaign = campaignSnapshot?.data;
  const preview = previewSnapshot?.data;
  const membership = membershipSnapshot?.data;
  // A stale capability response must never leave a write armed.
  const writes = detail.writes.ok ? detail.writes.data ?? undefined : undefined;
  const configurationFresh = detail.campaign.ok && detail.writes.ok;
  const assignmentsFresh = configurationFresh && detail.preview.ok && detail.membership.ok;
  const groupsGate: WriteGate | undefined = writable ? assignmentsFresh
    ? canWrite(writable, writes, "groups", "promos", "paused_promos", "weekly")
    : { allowed: false, reason: UNAVAILABLE_SAVE } : undefined;
  const switchGate: WriteGate = configurationFresh
    ? canWrite(writable, writes, "campaigns", "enabled") : { allowed: false, reason: UNAVAILABLE_SAVE };
  const captionsFresh = configurationFresh && detail.preview.ok;
  const samples = preview?.captions.map((_, index) => preview.groups.find((row) => row.variant === index));
  const sendingToday = preview?.groups.filter((row) => row.sendsToday).length;
  const pausedRows = preview?.groups.filter((row) => row.paused).length ?? 0;
  const heldBack = preview ? preview.groups.length - (sendingToday ?? 0) - pausedRows : 0;
  const retry = () => { if (!pending) startTransition(() => router.refresh()); };
  const notice = (label: string, resource: ReadResource<unknown>, lastAt?: string) =>
    <ReadNotice label={label} resource={resource} lastAt={lastAt} retry={retry} pending={pending} />;

  return <>
    <PageHead title={campaignTitle(slug)} subtitle={campaign
      ? campaign.enabled
        ? `Runs at ${slotLabel(campaign)} ${campaign.timezone} · ${campaign.name}`
        : `Not posting (${campaignOffLabel(campaign)}) — would run at ${slotLabel(campaign)} ${campaign.timezone} · ${campaign.name}`
      : "Campaign details are unavailable."}
      actions={<Link className="link" href="/campaigns">All campaigns</Link>} />

    {notice("Campaign details", detail.campaign, campaignSnapshot?.receivedAt)}
    {writable ? notice("Save availability", detail.writes) : null}
    {writable && campaign ? <CampaignSwitch slug={slug} title={campaignTitle(slug)}
      storeEnabled={campaign.storeEnabled ?? campaign.enabled} cronEnabled={campaign.cronEnabled} gate={switchGate} /> : null}

    {notice("Campaign preview", detail.preview, previewSnapshot?.receivedAt)}
    <div className="grid grid-stats" style={{ marginBottom: 16 }}>
      <Stat label="Groups targeted" value={campaign?.targetCount ?? "—"} />
      <Stat label="Posting today" value={sendingToday ?? "—"} note={preview
        ? `${heldBack} held back by caps${pausedRows > 0 ? ` · ${pausedRows} paused` : ""}` : "Preview unavailable"} />
      <Stat label="Caption variants" value={preview?.captions.length ?? "—"} />
      <Stat label="Ref prefix" value={preview?.tracking.prefix ?? "—"} note={preview?.tracking.label} />
    </div>
    <p className="card-note campaign-live-stats-note">Statistics show the latest loaded configuration and leave out changes not yet applied. Data marked out of date may have changed on the bot.</p>

    {campaign ? <CampaignImages images={campaign.images} assets={campaign.assets}
      adAssets={detail.adAssets ?? undefined} assetDir={campaignAssetDir(campaign.script)}
      writable={writable} writeUnavailableReason={imageUnavailableReason} /> : <UnavailableSection title="Pictures" />}

    {preview ? <CaptionVariants slug={slug} captions={preview.captions} writable={writable}
      saveUnavailableReason={captionsFresh ? captionUnavailableReason : UNAVAILABLE_SAVE}
      samples={samples!.map((sample) => sample ? { label: groupLabel(sample), ref: sample.ref, caption: sample.caption } : null)} />
      : <UnavailableSection title="Caption variants" />}

    {notice("Group membership", detail.membership, membershipSnapshot?.receivedAt)}
    {preview ? <CampaignGroups slug={slug}
      liveGroups={preview.groups.map(({ caption, cap, ...row }) => row)}
      knownGroups={membership ? membership.groups.map(({ jid, name, account, status }) => ({ jid, name, account, status })) : NO_GROUPS}
      variantCount={preview.captions.length} gate={groupsGate}
      membershipAvailable={detail.membership.ok} membershipLoaded={Boolean(membership)}
      previewAvailable={detail.preview.ok} /> : <UnavailableSection title="Where it goes" />}
  </>;
}
