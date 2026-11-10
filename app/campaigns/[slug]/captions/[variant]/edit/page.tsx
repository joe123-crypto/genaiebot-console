import { notFound } from "next/navigation";
import { Shell } from "@/app/_components/shell-wrapper";
import { CaptionEditorScreen } from "@/app/campaigns/_components/caption-editor";
import { loadCampaignDetail } from "@/src/domains/campaign-detail";
import { captionSaveUnavailableReason } from "@/src/lib/bot-client";
import { isCaptionVariant } from "@/src/lib/caption-editor";
import { WRITES_ENABLED } from "@/src/config";
import { captionAIUnavailableReason } from "@/src/lib/caption-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function CaptionEditorPage({ params }: { params: Promise<{ slug: string; variant: string }> }) {
  const { slug, variant } = await params;
  if (!isCaptionVariant(variant)) notFound();
  const detail = await loadCampaignDetail(slug);
  if (detail.campaign.ok && detail.campaign.data === null) notFound();
  return <Shell><CaptionEditorScreen key={`${slug}:${variant}`} slug={slug} variant={variant} detail={detail}
    writable={WRITES_ENABLED}
    aiUnavailableReason={captionAIUnavailableReason()}
    saveUnavailableReason={captionSaveUnavailableReason(detail.writes.ok ? detail.writes.data ?? undefined : undefined)} />
  </Shell>;
}
