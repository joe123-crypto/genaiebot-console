import type { Tracking } from "@/src/lib/types";

export const CAMPAIGN_IMAGE_BYTES = 6 * 1024 * 1024;
export const CAMPAIGN_IMAGE_ACCEPT = "image/jpeg,image/png";
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const CAMPAIGN_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export type CampaignImageUpload = {
  filename: string; key: string; sha256: string; bytes: number;
  contentType: "image/jpeg" | "image/png";
};
export type NewCampaign = {
  requestId: string; slug: string; name: string; enabled: boolean;
  captions: string[]; images: CampaignImageUpload[];
  schedule: { time: string; timezone: string; weekdays: number[] };
  groups: { jid: string; weekdays?: number[]; paused?: boolean }[];
  tracking?: Tracking; comment?: string; weeklyComment?: string;
  timeoutSeconds?: number; failureAlertTo?: string;
};
export type CreateCampaignResult = { slug: string; scheduling: "ready" | "pending"; warning?: string };
export type CreateCampaignOutcome = ({ ok: true } & CreateCampaignResult) | { ok: false; detail: string };
export function campaignSlug(name: string) {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
  return slug === "new" ? "new-campaign" : slug;
}
function weekdays(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 7 &&
    new Set(value).size === value.length && value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}
export function uploadError(value: unknown, slug: string): string | undefined {
  if (!value || typeof value !== "object") return "Choose a JPEG or PNG picture.";
  const image = value as CampaignImageUpload;
  if (!["image/jpeg", "image/png"].includes(image.contentType)) return "Pictures must be JPEG or PNG.";
  if (!Number.isInteger(image.bytes) || image.bytes <= 0 || image.bytes > CAMPAIGN_IMAGE_BYTES) return "Each picture must be between 1 byte and 6 MiB.";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png)$/i.test(image.filename)) return "Picture filenames must use letters, numbers, dots, dashes or underscores and end in .jpg or .png.";
  if (!/^[a-f0-9]{64}$/.test(image.sha256)) return "The picture checksum is invalid.";
  const extension = image.contentType === "image/png" ? "png" : "jpg";
  if (image.key !== `ads/${slug}/${image.sha256}.${extension}`) return "The picture does not belong to this campaign.";
}
/** The same checks run in the form and on the server; the bot checks again. */
export function campaignCreateError(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return "The campaign could not be read.";
  const campaign = value as NewCampaign;
  if (typeof campaign.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(campaign.requestId)) return "The creation request ID is invalid.";
  if (typeof campaign.slug !== "string" || (!CAMPAIGN_SLUG.test(campaign.slug) || campaign.slug === "new")) return "Enter a name containing letters or numbers (campaign IDs have at most 64 characters).";
  if (typeof campaign.name !== "string" || !campaign.name.trim() || campaign.name.length > 120) return "Enter a campaign name of at most 120 characters.";
  if (typeof campaign.enabled !== "boolean") return "Enabled must be on or off.";
  if (!Array.isArray(campaign.captions) || !campaign.captions.length || campaign.captions.some((caption) => typeof caption !== "string" || !caption.trim())) return "Enter text for every caption and keep at least one variant.";
  if (!Array.isArray(campaign.images) || !campaign.images.length || campaign.images.length > 20) return "Choose between 1 and 20 pictures.";
  for (const image of campaign.images) { const error = uploadError(image, campaign.slug); if (error) return error; }
  if (new Set(campaign.images.map((image) => image.filename)).size !== campaign.images.length || new Set(campaign.images.map((image) => image.key)).size !== campaign.images.length) return "Remove duplicate pictures or filenames.";
  if (!campaign.schedule || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(campaign.schedule.time) || !weekdays(campaign.schedule.weekdays)) return "Choose a posting time and at least one weekday.";
  try { if (!campaign.schedule.timezone) return "Choose a timezone."; new Intl.DateTimeFormat("en", { timeZone: campaign.schedule.timezone }); } catch { return "Enter a valid timezone, such as Africa/Harare."; }
  if (!Array.isArray(campaign.groups) || !campaign.groups.length || campaign.groups.length > 100 || new Set(campaign.groups.map((group) => group?.jid)).size !== campaign.groups.length) return "Select between 1 and 100 different active groups.";
  for (const group of campaign.groups) {
    if (!group || typeof group.jid !== "string" || !/^[0-9-]+@g\.us$/.test(group.jid)) return "A selected group ID is invalid.";
    if (group.paused !== undefined && typeof group.paused !== "boolean") return "A group pause must be on or off.";
    if (group.weekdays !== undefined && (!weekdays(group.weekdays) || group.weekdays.some((day) => !campaign.schedule.weekdays.includes(day)))) return "Group weekdays must be a nonempty subset of the campaign weekdays.";
  }
  if (campaign.timeoutSeconds !== undefined && (!Number.isInteger(campaign.timeoutSeconds) || campaign.timeoutSeconds < 60 || campaign.timeoutSeconds > 7200)) return "Execution timeout must be between 60 and 7200 seconds.";
  if (campaign.failureAlertTo && !/^\+[1-9][0-9]{6,14}$/.test(campaign.failureAlertTo)) return "Use an international phone number for failure alerts.";
  if (campaign.tracking !== undefined) {
    if (!campaign.tracking || typeof campaign.tracking !== "object" || Array.isArray(campaign.tracking) || typeof campaign.tracking.prefix !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(campaign.tracking.prefix)) return "Enter a tracking prefix using letters, numbers or dashes, or leave tracking blank.";
    for (const [key, text] of Object.entries(campaign.tracking)) if (!["prefix", "label", "number", "prefill", "link_line"].includes(key) || typeof text !== "string" || text.length > 1000) return "Tracking settings contain an invalid value.";
    if (campaign.tracking.number && !/^\+[1-9][0-9]{6,14}$/.test(campaign.tracking.number)) return "Use an international contact phone number.";
  }
  for (const field of ["comment", "weeklyComment"] as const) if (campaign[field] !== undefined && (typeof campaign[field] !== "string" || campaign[field]!.length > 2000)) return "Notes must be at most 2000 characters.";
  if (new TextEncoder().encode(JSON.stringify(campaign)).length > 60 * 1024) return "The campaign configuration is too large. Shorten the captions or notes.";
}
