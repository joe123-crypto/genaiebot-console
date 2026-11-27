import { BOT_PROVISIONING } from "@/src/config";
import { requireOnboarding } from "@/src/lib/onboarding";
import { CreateBot } from "@/app/setup/create-bot";
import { OnboardingFrame } from "../_components/onboarding-frame";

export const dynamic = "force-dynamic";

export default async function OnboardingBotPage() {
  const { operator, workspace } = await requireOnboarding("bot");
  return (
    <OnboardingFrame operator={operator} step="bot" title="Create your bot"
      subtitle="Your bot is what posts your campaigns and answers on WhatsApp. It takes a few minutes to set up.">
      <CreateBot workspace={{ id: workspace.id, name: workspace.name }} enabled={BOT_PROVISIONING !== "none"}
        next={{ href: "/onboarding/whatsapp", label: "Continue" }} />
    </OnboardingFrame>
  );
}
