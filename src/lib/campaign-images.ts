import type { CampaignAsset } from "@/src/lib/types";

/**
 * Where a campaign picture's pixels come from, and what the console will accept
 * as a new one.
 *
 * The pictures live in a Cloudflare R2 bucket and the index of them in
 * Firestore, so the bot reports each one's public URL beside the basename its
 * `post_ad.py` declares, and a tile loads that URL directly. The console never
 * sees the bucket, the keys or the credentials, and never proxies the bytes:
 * the URL is composed on the bot from one environment variable, so putting a
 * custom domain in front of the bucket moves the console with it and changes
 * nothing here.
 *
 * Two lists meet in this file. `images` is what the campaign's post script
 * declares and, until the R2 cutover, still what a run attaches; `assets` is
 * what the index says. They agree today. `assetFor` is the join, and a name
 * with no entry keeps its unavailable tile — which is a real signal, not a
 * missing feature.
 */

/** What the file picker offers. WhatsApp re-encodes anything it sends anyway. */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A campaign picture's index entry, by the name the post script declares.
 *  `undefined` when the index does not mention it. */
export function assetFor(assets: CampaignAsset[], name: string) {
  return assets.find((asset) => asset.filename === name);
}

/** The address a tile loads, or undefined when there is nothing to load: the
 *  index does not know this picture, or the bot has no base URL configured. */
export function campaignImageSrc(assets: CampaignAsset[], name: string) {
  return assetFor(assets, name)?.url || undefined;
}

/** Why a picked file cannot become a campaign picture, if it cannot. */
export function imagePickError(file: File) {
  if (!IMAGE_ACCEPT.split(",").includes(file.type)) {
    return `${file.name} is not a JPEG, PNG or WebP image.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name} is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`;
  }
  return undefined;
}

/** The first name declared twice. The bot rotates by position, so a repeat is
 *  not an error it would catch — it would just post the same picture twice as
 *  often, which is never what the operator meant. */
export function duplicateImageName(names: string[]) {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return undefined;
}

/** Where a campaign's picture files sit in the bot's checkout, derived from the
 *  script path the read bridge already reports. Not a URL and not fetchable —
 *  it is where the copy baked into the container lives, which is still what a
 *  run attaches until the R2 cutover. */
export function campaignAssetDir(script: string | null) {
  if (!script) return null;
  const dir = script.replace(/\/[^/]*$/, "");
  return dir === script ? null : `${dir}/assets`;
}
