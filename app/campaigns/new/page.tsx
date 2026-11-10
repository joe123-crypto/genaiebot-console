import Link from "next/link";
import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { NewCampaignForm } from "@/app/campaigns/_components/new-campaign-form";
import { WRITES_ENABLED } from "@/src/config";
import { getCapabilities, BotUnavailableError } from "@/src/lib/bot-client";
import { canCreateCampaign } from "@/src/lib/write-capabilities";
import { imageUploadConfigured } from "@/src/lib/campaign-upload";
export const dynamic = "force-dynamic";
export default async function NewCampaignPage() {
  try {
    const writes = await getCapabilities();
    let gate = canCreateCampaign(WRITES_ENABLED, writes);
    if (gate.allowed && !imageUploadConfigured()) gate = { allowed: false, reason: "Picture upload storage is not configured on the console." };
    return <Shell live><PageHead title="New campaign" subtitle="Create an advert and choose when and where it runs."
      actions={<Link prefetch={false} className="link" href="/campaigns">All campaigns</Link>} />
      <NewCampaignForm groups={[]} paginated gate={gate} />
    </Shell>;
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return <Shell live><PageHead title="New campaign" subtitle="Create an advert and choose when and where it runs."
      actions={<Link prefetch={false} className="link" href="/campaigns">All campaigns</Link>} />
      <NewCampaignForm groups={[]} paginated gate={{ allowed: false, reason: "Creation is unavailable until campaign data refreshes successfully." }} loadError={error.detail} /></Shell>;
  }
}
