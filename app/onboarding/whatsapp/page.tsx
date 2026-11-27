import { ACCOUNT_WRITES_ENABLED, WRITES_ENABLED } from "@/src/config";
import { requireOnboarding } from "@/src/lib/onboarding";
import { OnboardingFrame } from "../_components/onboarding-frame";
import { FirstLineLink } from "../_components/first-line-link";

export const dynamic = "force-dynamic";

export default async function OnboardingWhatsAppPage() {
  const { operator } = await requireOnboarding("whatsapp");
  return (
    <OnboardingFrame operator={operator} step="whatsapp" title="Connect WhatsApp"
      subtitle="Link the WhatsApp number your bot will post from.">
      <FirstLineLink writesEnabled={ACCOUNT_WRITES_ENABLED} configWrites={WRITES_ENABLED} nextHref="/onboarding/campaign" />
    </OnboardingFrame>
  );
}
