import { getLiveView } from "@/src/lib/live-client";
import { BotUnavailableError, getCampaignPreview, getCampaignPayload, getCapabilities, getGroups } from "@/src/lib/bot-client";
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
  membershipScoped?: boolean;
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
    resource(() => getCampaignPayload(slug)),
    resource(() => getCampaignPreview(slug)),
    resource(() => getGroups(undefined, { campaign: slug })),
    resource(async () => (await getCapabilities()) ?? null),
  ]);
  const campaign: ReadResource<Campaign | null> = campaigns.ok
    ? { ...campaigns, data: campaigns.data.campaign }
    : campaigns;
  return { campaign, adAssets: campaigns.ok ? campaigns.data.adAssets ?? null : null,
           preview, membership, writes, membershipScoped: true };
}

/** Caption editing needs text and save capabilities, not membership or assets. */
export type CaptionEditorDetail = {
  campaign: ReadResource<Pick<Campaign, "slug" | "name" | "source"> | null>;
  preview: ReadResource<Pick<CampaignPreview, "captions">>;
  writes: ReadResource<WriteCapabilities | null>;
  sync?: import("@/src/lib/live-types").SyncStatus;
};
export async function loadCaptionEditorDetail(slug: string): Promise<CaptionEditorDetail> {
  try {
    const data = await getLiveView<{ campaign: Pick<Campaign, "slug" | "name" | "source"> | null; captions: string[]; writes?: WriteCapabilities; sync: import("@/src/lib/live-types").SyncStatus }>("captions", new URLSearchParams({ slug }));
    const receivedAt = new Date().toISOString();
    return { campaign: { ok: true, data: data.campaign, receivedAt }, preview: { ok: true, data: { captions: data.captions }, receivedAt },
      writes: { ok: true, data: data.writes ?? null, receivedAt }, sync: data.sync };
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    const failed = { ok: false as const, error: { detail: error.detail, ...(error.status === undefined ? {} : { status: error.status }) } };
    return { campaign: failed, preview: failed, writes: failed };
  }
}
