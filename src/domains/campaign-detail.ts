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

/** Caption editing needs text and save capabilities, not membership. The
 *  picture URLs ride along so the assistant can be shown the advert itself. */
export type CaptionEditorDetail = {
  campaign: ReadResource<Pick<Campaign, "slug" | "name" | "source"> | null>;
  preview: ReadResource<Pick<CampaignPreview, "captions">>;
  writes: ReadResource<WriteCapabilities | null>;
  /** Public asset URLs for the campaign's pictures; empty when that read failed
   *  or the bot reports none. Never a reason to fail the editor. */
  pictures?: string[];
  sync?: import("@/src/lib/live-types").SyncStatus;
};

/** The pictures the assistant may be shown, in the order the campaign posts
 *  them. A picture the index does not know has no URL and is skipped. */
async function campaignPictures(slug: string): Promise<string[]> {
  try {
    const { campaign } = await getCampaignPayload(slug);
    return (campaign?.assets ?? []).flatMap((asset) => asset.url ? [asset.url] : []);
  } catch (error) {
    if (!(error instanceof BotUnavailableError)) throw error;
    return [];
  }
}
export async function loadCaptionEditorDetail(slug: string): Promise<CaptionEditorDetail> {
  const [captions, pictures] = await Promise.all([
    getLiveView<{ campaign: Pick<Campaign, "slug" | "name" | "source"> | null; captions: string[]; writes?: WriteCapabilities; sync: import("@/src/lib/live-types").SyncStatus }>("captions", new URLSearchParams({ slug }))
      .then((data) => ({ ok: true as const, data }), (error: unknown) => {
        if (!(error instanceof BotUnavailableError)) throw error;
        return { ok: false as const, error };
      }),
    campaignPictures(slug),
  ]);
  if (!captions.ok) {
    const failed = { ok: false as const, error: { detail: captions.error.detail, ...(captions.error.status === undefined ? {} : { status: captions.error.status }) } };
    return { campaign: failed, preview: failed, writes: failed, pictures };
  }
  const data = captions.data;
  const receivedAt = new Date().toISOString();
  return { campaign: { ok: true, data: data.campaign, receivedAt }, preview: { ok: true, data: { captions: data.captions }, receivedAt },
    writes: { ok: true, data: data.writes ?? null, receivedAt }, pictures, sync: data.sync };
}
