import { Shell } from "@/app/_components/shell-wrapper";
import { IndexedCampaignView } from "../_components/indexed-campaign-view";
import { getLiveView } from "@/src/lib/live-client";
import { BotUnavailableError } from "@/src/lib/bot-client";
import { WRITES_ENABLED } from "@/src/config";
import type { CampaignRow, SyncStatus } from "@/src/lib/live-types";
import type { LiveContext } from "@/src/lib/live-types";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let initial: { campaign: CampaignRow | null; context?: LiveContext; sync: SyncStatus } | null = null;
  let initialError: string | undefined;
  try { initial = await getLiveView("campaign", new URLSearchParams({ slug })); }
  catch (error) { if (!(error instanceof BotUnavailableError)) throw error; initialError = error.detail; }
  if (initial?.campaign === null && !initial.sync.stale) notFound();
  return <Shell live><IndexedCampaignView key={slug} slug={slug} initial={initial} initialError={initialError} writable={WRITES_ENABLED} /></Shell>;
}
