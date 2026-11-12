import { Shell } from "@/app/_components/shell-wrapper";
import { CampaignCaptionStep } from "@/app/campaigns/_components/campaign-caption-step";
import { WRITES_ENABLED } from "@/src/config";
import { getCapabilities, BotUnavailableError } from "@/src/lib/bot-client";
import { canCreateCampaign } from "@/src/lib/write-capabilities";
import { captionAIUnavailableReason } from "@/src/lib/caption-ai";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export default async function NewCampaignCaptionPage() {
  try {
    const writes = await getCapabilities();
    const gate = canCreateCampaign(WRITES_ENABLED, writes);
    return <Shell live><CampaignCaptionStep gate={gate} aiUnavailableReason={captionAIUnavailableReason()} /></Shell>;
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return <Shell live><CampaignCaptionStep aiUnavailableReason={captionAIUnavailableReason()}
      gate={{ allowed: false, reason: "Creation is unavailable until campaign data refreshes successfully." }} loadError={error.detail} /></Shell>;
  }
}
