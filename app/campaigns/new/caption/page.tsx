import { requireOperator } from "@/src/lib/auth";
import { requireBot } from "@/src/lib/workspace";
import { Shell } from "@/app/_components/shell-wrapper";
import { CampaignCaptionStep } from "@/app/campaigns/_components/campaign-caption-step";
import { WRITES_ENABLED } from "@/src/config";
import { getCapabilities, BotUnavailableError } from "@/src/lib/bot-client";
import { canCreateInWorkspace } from "@/src/lib/write-capabilities";
import { campaignRequirements } from "@/src/domains/campaign-create";
import { captionAIUnavailableReason } from "@/src/lib/caption-ai";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export default async function NewCampaignCaptionPage() {
  await requireOperator();
  const workspace = await requireBot();
  try {
    const writes = await getCapabilities();
    const gate = canCreateInWorkspace(WRITES_ENABLED, writes, workspace.id);
    return <Shell live><CampaignCaptionStep gate={gate} requirements={campaignRequirements(writes)} aiUnavailableReason={captionAIUnavailableReason()} /></Shell>;
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return <Shell live><CampaignCaptionStep aiUnavailableReason={captionAIUnavailableReason()}
      gate={{ allowed: false, reason: "Creation is unavailable until campaign data refreshes successfully." }} loadError={error.detail} /></Shell>;
  }
}
