import Link from "next/link";
import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { NewCampaignForm } from "@/app/campaigns/_components/new-campaign-form";
import { WRITES_ENABLED } from "@/src/config";
import { getCapabilities, getGroups, BotUnavailableError } from "@/src/lib/bot-client";
import { canCreateCampaign } from "@/src/lib/write-capabilities";
import { imageUploadConfigured } from "@/src/lib/campaign-upload";
export const dynamic = "force-dynamic";
export default async function NewCampaignPage() {
  try {
    const [writes, membership] = await Promise.all([getCapabilities(), getGroups()]);
    let gate = canCreateCampaign(WRITES_ENABLED, writes);
    if (gate.allowed && !imageUploadConfigured()) gate = { allowed: false, reason: "Picture upload storage is not configured on the console." };
    return <Shell><PageHead title="New campaign" subtitle="Create an advert and choose when and where it runs."
      actions={<Link className="link" href="/campaigns">All campaigns</Link>} />
      <NewCampaignForm groups={membership.groups.map(({ jid, name, account, status }) => ({ jid, name, account, status }))} gate={gate} />
    </Shell>;
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return <Shell><PageHead title="New campaign" subtitle="Create an advert and choose when and where it runs."
      actions={<Link className="link" href="/campaigns">All campaigns</Link>} />
      <NewCampaignForm groups={[]} gate={{ allowed: false, reason: "Creation is unavailable until campaign data refreshes successfully." }} loadError={error.detail} /></Shell>;
  }
}
