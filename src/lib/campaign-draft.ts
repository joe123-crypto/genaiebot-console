import { campaignDraftError, type CampaignDraft } from "@/src/domains/campaign-create";

/** The campaign details waiting for their captions, kept between the two steps. */
export const CAMPAIGN_DRAFT_KEY = "genaie:campaign-create:v1";
export const CAMPAIGN_CAPTIONS_KEY = "genaie:campaign-create-captions:v1";
/** Group names ride along so stepping back shows the chips, not bare JIDs. */
export type StashedDraft = { version: 1; draft: CampaignDraft; groupNames?: Record<string, string> };

export function parseCampaignDraft(raw: string): { draft: CampaignDraft; groupNames: Record<string, string> } {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid campaign draft");
  const stash = value as Record<string, unknown>;
  if (stash.version !== 1) throw new Error("Invalid campaign draft");
  // The details were valid when stashed; a draft that no longer passes has been
  // tampered with or outlived its format, and the operator must fill it again.
  if (campaignDraftError(stash.draft)) throw new Error("Invalid campaign draft");
  const names = stash.groupNames;
  const groupNames = names && typeof names === "object" && !Array.isArray(names)
    ? Object.fromEntries(Object.entries(names as Record<string, unknown>).filter(([, name]) => typeof name === "string")) as Record<string, string>
    : {};
  return { draft: stash.draft as CampaignDraft, groupNames };
}

export function parseCampaignCaptions(raw: string): string[] {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid captions draft");
  const stash = value as Record<string, unknown>;
  if (stash.version !== 1 || !Array.isArray(stash.captions) ||
      !stash.captions.every((text) => typeof text === "string")) throw new Error("Invalid captions draft");
  return stash.captions as string[];
}
