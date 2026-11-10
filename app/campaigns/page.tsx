import Link from "next/link";
import { Shell } from "@/app/_components/shell-wrapper";
import { PageHead } from "@/app/_components/ui";
import { LiveCampaigns } from "./_components/live-campaigns";
import { getLiveView } from "@/src/lib/live-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
import { parseCampaignFilter, campaignFilterQuery } from "@/src/domains/campaign-filter";
import { WRITES_ENABLED } from "@/src/config";
import type { CampaignRow, LivePage } from "@/src/lib/live-types";
export const dynamic = "force-dynamic";
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = parseCampaignFilter(await searchParams);
  let initial: LivePage<CampaignRow> | null = null;
  let initialError: string | undefined;
  try { initial = await getLiveView("campaigns", campaignFilterQuery(filter)); }
  catch (error) { if (!(error instanceof BotUnavailableError)) throw error; initialError = error.detail; }
  return <Shell live><PageHead title="Campaigns" actions={<Link prefetch={false} className="btn btn-primary" href="/campaigns/new">New campaign</Link>} />
    <LiveCampaigns initial={initial} initialError={initialError} filter={filter} writable={WRITES_ENABLED} /></Shell>;
}
