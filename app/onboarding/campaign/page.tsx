import { WRITES_ENABLED } from "@/src/config";
import { getCapabilities, BotUnavailableError } from "@/src/lib/bot-client";
import { canCreateInWorkspace, type WriteGate } from "@/src/lib/write-capabilities";
import { CAMPAIGN_REQUIRES_ALL, campaignRequirements, keyPrefixOf, type CampaignRequirements } from "@/src/domains/campaign-create";
import { imageUploadConfigured } from "@/src/lib/campaign-upload";
import { requireOnboarding } from "@/src/lib/onboarding";
import { NewCampaignForm } from "@/app/campaigns/_components/new-campaign-form";
import { OnboardingFrame } from "../_components/onboarding-frame";

export const dynamic = "force-dynamic";

/** The same form as /campaigns/new, run under the wizard's own URLs. */
export default async function OnboardingCampaignPage() {
  const { operator, workspace } = await requireOnboarding("campaign");
  let gate: WriteGate;
  let keyPrefix: string | undefined;
  let loadError: string | undefined;
  let requirements: CampaignRequirements = CAMPAIGN_REQUIRES_ALL;
  try {
    const writes = await getCapabilities();
    gate = canCreateInWorkspace(WRITES_ENABLED, writes, workspace.id);
    if (gate.allowed && !imageUploadConfigured()) gate = { allowed: false, reason: "Picture upload storage is not configured on the console." };
    keyPrefix = keyPrefixOf(writes);
    requirements = campaignRequirements(writes);
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    gate = { allowed: false, reason: "Creation is unavailable until campaign data refreshes successfully." };
    loadError = error.detail;
  }
  return (
    <OnboardingFrame operator={operator} step="campaign" title="Create your first campaign" width="wide"
      subtitle="An advert your bot posts to your WhatsApp groups on a schedule.">
      <NewCampaignForm groups={[]} paginated gate={gate} keyPrefix={keyPrefix} loadError={loadError} requirements={requirements}
        nextHref="/onboarding/campaign/caption" cancelHref="/onboarding/campaign" />
    </OnboardingFrame>
  );
}
