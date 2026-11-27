import { WRITES_ENABLED } from "@/src/config";
import { getCapabilities, BotUnavailableError } from "@/src/lib/bot-client";
import { canCreateInWorkspace, type WriteGate } from "@/src/lib/write-capabilities";
import { captionAIUnavailableReason } from "@/src/lib/caption-ai";
import { CAMPAIGN_REQUIRES_ALL, campaignRequirements, type CampaignRequirements } from "@/src/domains/campaign-create";
import { requireOnboarding } from "@/src/lib/onboarding";
import { OnboardingFrame } from "../../_components/onboarding-frame";
import { OnboardingCaptionStep } from "../../_components/onboarding-caption-step";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function OnboardingCampaignCaptionPage() {
  const { operator, workspace } = await requireOnboarding("campaign");
  let gate: WriteGate;
  let loadError: string | undefined;
  let requirements: CampaignRequirements = CAMPAIGN_REQUIRES_ALL;
  try {
    const writes = await getCapabilities();
    gate = canCreateInWorkspace(WRITES_ENABLED, writes, workspace.id);
    requirements = campaignRequirements(writes);
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    gate = { allowed: false, reason: "Creation is unavailable until campaign data refreshes successfully." };
    loadError = error.detail;
  }
  return (
    <OnboardingFrame operator={operator} step="campaign" width="wide">
      <OnboardingCaptionStep gate={gate} loadError={loadError} requirements={requirements} aiUnavailableReason={captionAIUnavailableReason()} />
    </OnboardingFrame>
  );
}
