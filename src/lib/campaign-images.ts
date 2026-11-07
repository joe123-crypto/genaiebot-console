/**
 * Where a campaign picture's pixels come from, and what the console will accept
 * as a new one.
 *
 * The read bridge reports a campaign's pictures as bare basenames — the files
 * themselves sit beside each `post_ad.py` in the genaebot checkout, and neither
 * adapter serves bytes. Everything that needs an image URL goes through
 * `campaignImageSrc`, so the route that eventually serves them is a one-file
 * change and no component has to be touched.
 */

/** What the file picker offers. WhatsApp re-encodes anything it sends anyway. */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Whether anything serves a campaign's picture files yet. Nothing does, so no
 * component asks: a tile that fetched regardless would put a doomed request and
 * a console error behind every picture on every page load and every refresh.
 * The route below is what flips this to `true`, and nothing else has to change.
 */
export const IMAGES_SERVED: boolean = false;

/**
 * Contract for the route that does not exist yet:
 *
 *   GET /api/campaigns/<slug>/image/<basename>
 *   200 with image/jpeg|png|webp and an immutable cache header;
 *   404 when the basename is not one of that campaign's declared pictures, or
 *   the file is not in the checkout.
 *
 * Until it exists every request 404s and each tile shows its unavailable state,
 * which is the same thing the operator sees for a picture that has gone missing
 * from the checkout. One state covers both.
 */
export function campaignImageSrc(slug: string, name: string) {
  return `/api/campaigns/${encodeURIComponent(slug)}/image/${encodeURIComponent(name)}`;
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

/** Where a campaign's picture files sit, derived from the script path the read
 *  bridge already reports. Not a URL and not fetchable — it is what an operator
 *  needs in order to find or replace a picture by hand today. */
export function campaignAssetDir(script: string | null) {
  if (!script) return null;
  const dir = script.replace(/\/[^/]*$/, "");
  return dir === script ? null : `${dir}/assets`;
}
