import { loadOverview } from "@/src/domains/console";
import { BotUnavailableError, getCampaignPreview, getCampaigns, getGroups } from "@/src/lib/bot-client";
import type { ReadResource } from "@/src/lib/read-resource";
import type { Campaign, CampaignPreview, GroupsPayload, WriteCapabilities } from "@/src/lib/types";

export type CampaignDetail = {
  campaign: ReadResource<Campaign | null>;
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
  const [campaign, preview, membership, writes] = await Promise.all([
    resource(async () => (await getCampaigns()).find((entry) => entry.slug === slug) ?? null),
    resource(() => getCampaignPreview(slug)),
    resource(() => getGroups()),
    resource(async () => {
      const result = await loadOverview();
      if (!result.ok) throw new BotUnavailableError(result.detail, result.status);
      return result.overview.writes ?? null;
    }),
  ]);
  return { campaign, preview, membership, writes };
}
