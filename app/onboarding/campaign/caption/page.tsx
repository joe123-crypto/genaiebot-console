import { WRITES_ENABLED } from "@/src/config";
import { getCapabilities, BotUnavailableError } from "@/src/lib/bot-client";
import { canCreateInWorkspace, type WriteGate } from "@/src/lib/write-capabilities";
import { captionAIUnavailableReason } from "@/src/lib/caption-ai";
import { requireOnboarding } from "@/src/lib/onboarding";
import { OnboardingFrame } from "../../_components/onboarding-frame";
import { OnboardingCaptionStep } from "../../_components/onboarding-caption-step";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function OnboardingCampaignCaptionPage() {
  const { operator, workspace } = await requireOnboarding("campaign");
  let gate: WriteGate;
  let loadError: string | undefined;
  try {
    gate = canCreateInWorkspace(WRITES_ENABLED, await getCapabilities(), workspace.id);
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    gate = { allowed: false, reason: "Creation is unavailable until campaign data refreshes successfully." };
    loadError = error.detail;
  }
  return (
    <OnboardingFrame operator={operator} step="campaign" wide>
      <OnboardingCaptionStep gate={gate} loadError={loadError} aiUnavailableReason={captionAIUnavailableReason()} />
    </OnboardingFrame>
  );
}
