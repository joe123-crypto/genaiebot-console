import Link from "next/link";
import { Shell } from "@/app/_components/shell-wrapper";
import { BotError, Empty, PageHead } from "@/app/_components/ui";
import { BotUnavailableError, getCampaigns } from "@/src/lib/bot-client";
import { loadOverview, parseCampaignFilter } from "@/src/domains/console";
import { plural } from "@/src/lib/format";
import { campaignDeleteReason, canDelete, canWrite } from "@/src/lib/write-capabilities";
import { WRITES_ENABLED } from "@/src/config";
import { CampaignsTable } from "@/app/campaigns/_components/campaigns-table";
import type { Campaign } from "@/src/lib/types";

export const dynamic = "force-dynamic";

/** Saying only "10 campaigns" would present a switched-off one as if it runs.
 *  This counts the record rather than the filtered view: how many campaigns
 *  there are does not change because someone searched, and the table reports
 *  its own count. */
function subtitle(campaigns: Campaign[]) {
  const off = campaigns.filter((campaign) => !campaign.enabled).length;
  const all = `${plural(campaigns.length, "campaign")}, in the order they run through the day.`;
  return off === 0 ? all : `${all} ${off} switched off and never posting.`;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Awaited before the read, so the error path below is untouched by it.
  const initialFilter = parseCampaignFilter(await searchParams);

  let campaigns: Campaign[];
  try {
    campaigns = await getCampaigns();
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return (
      <Shell>
        <PageHead title="Campaigns" actions={<Link className="btn btn-primary" href="/campaigns/new">New campaign</Link>} />
        <BotError detail={error.detail} />
      </Shell>
    );
  }

  // Already read for this request by the layout, so this costs nothing. A read
  // that failed leaves `writes` undefined, which every gate reads as "cannot",
  // never as "everything is writable".
  const loaded = await loadOverview();
  const writes = loaded.ok ? loaded.overview.writes : undefined;

  return (
    <Shell overview={loaded.ok ? loaded.overview : undefined}>
      <PageHead title="Campaigns" subtitle={subtitle(campaigns)} actions={<Link className="btn btn-primary" href="/campaigns/new">New campaign</Link>} />

      {campaigns.length === 0 ? (
        <Empty>No campaigns are declared.</Empty>
      ) : (
        <CampaignsTable
          campaigns={campaigns}
          initialFilter={initialFilter}
          writesEnabled={WRITES_ENABLED}
          switchGate={canWrite(WRITES_ENABLED, writes, "campaigns", "enabled")}
          deleteReason={campaignDeleteReason(canDelete(WRITES_ENABLED, writes, "campaigns"))}
        />
      )}
    </Shell>
  );
}
