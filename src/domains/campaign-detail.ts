import { loadOverview } from "@/src/domains/console";
import { BotUnavailableError, getCampaignPreview, getCampaignsPayload, getGroups } from "@/src/lib/bot-client";
import type { ReadResource } from "@/src/lib/read-resource";
import type { AdAssets, Campaign, CampaignPreview, GroupsPayload, WriteCapabilities } from "@/src/lib/types";

export type CampaignDetail = {
  campaign: ReadResource<Campaign | null>;
  /** Where the pictures are stored, taken from the same read as the campaign
   *  rather than fetched again: it describes the bot, not the campaign, and a
   *  second read would ask the bridge the same question twice. Null when that
   *  read failed, or when the bot is older than the index report. */
  adAssets: AdAssets | null;
  preview: ReadResource<CampaignPreview>;
  membership: ReadResource<GroupsPayload>;
  writes: ReadResource<WriteCapabilities | null>;
};

async function resource<T>(read: () => Promise<T>): Promise<ReadResource<T>> {
  try {
    return { ok: true, data: await read(), receivedAt: new Date().toISOString() };
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return { ok: false, error: { detail: error.detail,
      ...(error.status === undefined ? {} : { status: error.status }) } };
  }
}

export async function loadCampaignDetail(slug: string): Promise<CampaignDetail> {
  const [campaigns, preview, membership, writes] = await Promise.all([
    resource(() => getCampaignsPayload()),
    resource(() => getCampaignPreview(slug)),
    resource(() => getGroups()),
    resource(async () => {
      const result = await loadOverview();
      if (!result.ok) throw new BotUnavailableError(result.detail, result.status);
      return result.overview.writes ?? null;
    }),
  ]);
  const campaign: ReadResource<Campaign | null> = campaigns.ok
    ? { ...campaigns, data: campaigns.data.campaigns.find((entry) => entry.slug === slug) ?? null }
    : campaigns;
  return { campaign, adAssets: campaigns.ok ? campaigns.data.adAssets ?? null : null,
           preview, membership, writes };
}
