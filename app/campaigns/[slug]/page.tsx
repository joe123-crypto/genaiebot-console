import { notFound } from "next/navigation";
import { Shell } from "@/app/_components/shell-wrapper";
import { CampaignDetailView } from "@/app/campaigns/_components/campaign-detail-view";
import { loadCampaignDetail } from "@/src/domains/campaign-detail";
import { captionSaveUnavailableReason, imageWritesUnavailableReason } from "@/src/lib/bot-client";
import { WRITES_ENABLED } from "@/src/config";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await loadCampaignDetail(slug);
  if (detail.campaign.ok && detail.campaign.data === null) notFound();

  return (
    <Shell>
      <CampaignDetailView key={slug} slug={slug} detail={detail} writable={WRITES_ENABLED}
        captionUnavailableReason={captionSaveUnavailableReason(detail.writes.ok ? detail.writes.data ?? undefined : undefined)}
        imageUnavailableReason={imageWritesUnavailableReason()} />
    </Shell>
  );
}
