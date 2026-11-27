"use client";

import { useState, type ReactNode } from "react";
import { Image as ImageIcon } from "lucide-react";
import { Section } from "@/app/_components/ui";
import { campaignImageSrc } from "@/src/lib/campaign-images";
import { plural } from "@/src/lib/format";
import type { AdAssets, CampaignAsset } from "@/src/lib/types";

const NO_ASSETS: CampaignAsset[] = [];

/**
 * One campaign's first picture, for a row in the campaigns list.
 *
 * A failed <img> paints the browser's own broken-image glyph, which no CSS can
 * suppress, so the element is dropped on error and the muted square with its
 * icon is what remains.
 */
export function CampaignThumb({ images, assets = NO_ASSETS, imageCount, thumbnailUrl }: {
  images?: string[];
  assets?: CampaignAsset[];
  imageCount?: number;
  thumbnailUrl?: string | null;
}) {
  const src = thumbnailUrl !== undefined
    ? thumbnailUrl || undefined
    : images?.[0] ? campaignImageSrc(assets, images[0]) : undefined;
  const count = imageCount ?? images?.length ?? 0;
  return (
    <span className="campaign-thumb" aria-hidden>
      <ImageIcon size={14} aria-hidden />
      {src ? <ThumbnailImage key={src} src={src} /> : null}
      {count > 1 ? <span className="campaign-thumb-more">+{count - 1}</span> : null}
    </span>
  );
}

/** A new URL remounts the image so a failed old URL cannot hide its replacement. */
function ThumbnailImage({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  return broken ? null : <img src={src} alt="" loading="lazy" decoding="async"
    onError={() => setBroken(true)} />;
}

/**
 * A campaign's pictures, in the order the bot declares them, as a column of
 * thumbnails beside the work rather than a wall of tiles above it: nothing
 * here can be edited yet, so they are reference, and each opens full size.
 *
 * The tiles are `images` — what the campaign's own post script declares, and
 * what a run attaches until the R2 cutover. The pixels come from `assets`, the
 * bot's Firestore index of what is in the bucket, joined by filename. A tile
 * with no entry keeps its unavailable state and says why: that is a picture
 * the post script declares and the index has never heard of, which is worth
 * seeing rather than hiding.
 *
 * Nothing can store a picture yet, so there are no add or remove controls:
 * a button that is always disabled is only something to read past. The
 * reason, `writeUnavailableReason`, is said once at the foot of the card
 * instead, and is required so that a screen cannot leave it out.
 */
export function CampaignImages({
  images, assets = NO_ASSETS, adAssets, assetDir, writable, writeUnavailableReason, textOnly = false,
}: {
  images: string[];
  /** The bot posts a picture-less campaign's caption as text
   *  (`campaignCreation.picturesOptional`), rather than refusing to send it. */
  textOnly?: boolean;
  assets?: CampaignAsset[];
  adAssets?: AdAssets;
  assetDir: string | null;
  writable: boolean;
  writeUnavailableReason: string;
}) {
  // A tile falls back to naming its file once the browser cannot fetch it,
  // which covers an object that has left the bucket as well as a bad URL.
  const [broken, setBroken] = useState<string[]>([]);
  // One explanation for the whole card beats the same sentence on every tile.
  const indexed = images.filter((name) => campaignImageSrc(assets, name));
  const missing = images.length - indexed.length;
  const source = images.length > 0
    ? pictureSource({ indexed: indexed.length, missing, adAssets, assetDir })
    : null;

  return (
    <Section id="campaign-images" className="campaign-images" title="Pictures"
      description={images.length > 1
        ? `${plural(images.length, "picture")}, one posted per day, so a group never sees the same one twice running.`
        : images.length === 1 ? `${plural(images.length, "picture")}, sent with every caption.` : undefined}
      footer={source || writable ? <>
        {source}
        {writable ? <p className="card-note">{writeUnavailableReason}</p> : null}
      </> : null}>
      {images.length > 0 ? (
        <div className="grid campaign-image-grid">
          {images.map((name, index) => {
            const src = campaignImageSrc(assets, name);
            const shown = src && !broken.includes(name);
            return (
              <figure className="campaign-image" key={name}>
                <div className="campaign-image-frame">
                  {shown ? (
                    <a href={src} target="_blank" rel="noreferrer" title={`Open ${name} full size`}>
                      <img src={src} alt={`Picture ${index + 1}`} loading="lazy" decoding="async"
                        onError={() => setBroken((names) => names.includes(name) ? names : [...names, name])} />
                    </a>
                  ) : (
                    <div className="campaign-image-missing">
                      <ImageIcon size={18} aria-hidden />
                      <span>Preview unavailable</span>
                    </div>
                  )}
                  <span className="campaign-image-number" aria-hidden>{index + 1}</span>
                </div>
                <figcaption className="cell-mono campaign-image-name" title={name}>{name}</figcaption>
              </figure>
            );
          })}
        </div>
      ) : textOnly ? (
        <p className="card-note">No pictures: each post is the caption as a text message.</p>
      ) : (
        <p className="card-note">
          This campaign declares no picture. A send would stop before posting, because the bot
          refuses a campaign whose image is missing.
        </p>
      )}
    </Section>
  );
}

/**
 * Where the pictures above came from, in the operator's terms -- but only
 * when that is worth knowing.
 *
 * Three different facts can leave a tile blank — the bot is too old to report
 * the index, the index could not be read, or the index simply does not list
 * that picture — and an operator about to go looking for a missing picture
 * needs to know which. The mode matters too: before the R2 cutover the tile is
 * the bucket's copy while the run still attaches the one baked into the
 * container, and claiming otherwise would be a lie by omission.
 *
 * The healthy case -- every picture served from the live index, in R2 mode --
 * says nothing: it is what the operator already assumes. Null then, rather
 * than an empty fragment, so the card can leave its footer off.
 */
function pictureSource({ indexed, missing, adAssets, assetDir }: {
  indexed: number;
  missing: number;
  adAssets?: AdAssets;
  assetDir: string | null;
}): ReactNode {
  if (!adAssets) {
    return <p className="card-note">
      This bot does not report where its pictures are stored yet, so tiles name their file
      instead.{assetDir ? <> The files are in <span className="cell-mono">{assetDir}</span>.</> : null}
    </p>;
  }
  // A mirrored list is real pictures from a stale catalogue, which is neither
  // "this is the index" nor "the index could not be read" — saying either one
  // alone would be wrong, so it gets its own sentence.
  const mirrored = adAssets.source === "mirror";
  const lead = indexed === 0
    ? <>The bot&rsquo;s asset index lists no picture for this campaign, so tiles name their
        file instead.</>
    : mirrored
      ? <>Pictures are the set committed at the bot&rsquo;s last deploy. It could not reach
          the live index, so a picture changed since then would not show here.</>
      : null;
  const absent = missing > 0 && indexed > 0
    ? <>{plural(missing, "picture")} {missing === 1 ? "is" : "are"} declared by the campaign
        but absent from the index, so {missing === 1 ? "it has" : "they have"} no preview.</>
    : null;
  if (!lead && !absent && !adAssets.note && adAssets.mode === "r2") return null;
  return <>
    {lead || absent ? <p className="card-note">{lead}{lead && absent ? " " : null}{absent}</p> : null}
    {adAssets.note
      ? <p className="card-note">
          {mirrored ? "Why the live index was not read" : "The index could not be read"}: {adAssets.note}
        </p>
      : null}
    {adAssets.mode !== "r2" ? (
      <p className="card-note">
        The bot still attaches the copy baked into its container
        {indexed > 0 ? <>, not the one shown here</> : null} — its picture source is{" "}
        <span className="cell-mono">{adAssets.mode}</span>.
        {assetDir ? <> That copy is in <span className="cell-mono">{assetDir}</span>.</> : null}
      </p>
    ) : null}
  </>;
}
