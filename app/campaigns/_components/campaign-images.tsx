"use client";

import { useState } from "react";
import { Image as ImageIcon, Plus, Trash2 } from "lucide-react";
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
export function CampaignThumb({ images, assets = NO_ASSETS }: {
  images: string[];
  assets?: CampaignAsset[];
}) {
  const [broken, setBroken] = useState(false);
  const src = images[0] ? campaignImageSrc(assets, images[0]) : undefined;
  return (
    <span className="campaign-thumb" aria-hidden>
      <ImageIcon size={14} aria-hidden />
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" decoding="async"
          onError={() => setBroken(true)} />
      ) : null}
      {images.length > 1 ? <span className="campaign-thumb-more">+{images.length - 1}</span> : null}
    </span>
  );
}

/**
 * A campaign's pictures, in the order the bot declares them.
 *
 * The tiles are `images` — what the campaign's own post script declares, and
 * what a run attaches until the R2 cutover. The pixels come from `assets`, the
 * bot's Firestore index of what is in the bucket, joined by filename. A tile
 * with no entry keeps its unavailable state and says why: that is a picture
 * the post script declares and the index has never heard of, which is worth
 * seeing rather than hiding.
 *
 * `writeUnavailableReason` is required rather than optional: nothing can store
 * a picture yet, so the add and remove controls are always rendered disabled
 * with the reason beside them. Making the reason impossible to omit is what
 * keeps a control from appearing that would silently do nothing.
 */
export function CampaignImages({
  images, assets = NO_ASSETS, adAssets, assetDir, writable, writeUnavailableReason,
}: {
  images: string[];
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

  return (
    <section className="card campaign-images" aria-labelledby="campaign-images-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="campaign-images-title">Pictures</h2>
          <p className="card-note">
            {images.length > 1
              ? `${plural(images.length, "picture")} — the bot posts one of them per day, chosen by the date, so a group never sees the same one twice running.`
              : `${plural(images.length, "picture")}, sent with every caption.`}
          </p>
        </div>
        {writable ? (
          <div className="campaign-image-actions">
            <button type="button" className="btn campaign-image-add" disabled title={writeUnavailableReason}>
              <Plus size={16} aria-hidden /> Add picture
            </button>
          </div>
        ) : null}
      </div>
      {writable ? <div className="caption-feedback"><p className="card-note">{writeUnavailableReason}</p></div> : null}
      <div className="card-pad grid campaign-image-grid">
        {images.map((name, index) => {
          const src = campaignImageSrc(assets, name);
          const shown = src && !broken.includes(name);
          return (
            <figure className="campaign-image" key={name}>
              <div className="campaign-image-head">
                <span className="pill pill-info">Picture {index + 1}</span>
                {writable ? (
                  <button type="button" className="row-action row-action-danger" disabled
                    aria-label={`Remove picture ${index + 1}`}
                    title={images.length === 1 ? "Keep at least one picture" : writeUnavailableReason}>
                    <Trash2 size={16} aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="campaign-image-frame">
                {shown ? (
                  <img src={src} alt="" loading="lazy" decoding="async"
                    onError={() => setBroken((names) => names.includes(name) ? names : [...names, name])} />
                ) : (
                  <div className="campaign-image-missing">
                    <ImageIcon size={20} aria-hidden />
                    <span>Preview unavailable</span>
                  </div>
                )}
              </div>
              <figcaption className="cell-mono campaign-image-name">{name}</figcaption>
            </figure>
          );
        })}
        {images.length === 0 ? (
          <p className="card-note">
            This campaign declares no picture. A send would stop before posting, because the bot
            refuses a campaign whose image is missing.
          </p>
        ) : null}
      </div>
      {images.length > 0 ? (
        <div className="caption-feedback">
          <PictureSource indexed={indexed.length} missing={missing} adAssets={adAssets}
            assetDir={assetDir} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Where the pictures above came from, in the operator's terms.
 *
 * Three different facts can leave a tile blank — the bot is too old to report
 * the index, the index could not be read, or the index simply does not list
 * that picture — and an operator about to go looking for a missing picture
 * needs to know which. The mode matters too: before the R2 cutover the tile is
 * the bucket's copy while the run still attaches the one baked into the
 * container, and claiming otherwise would be a lie by omission.
 */
function PictureSource({ indexed, missing, adAssets, assetDir }: {
  indexed: number;
  missing: number;
  adAssets?: AdAssets;
  assetDir: string | null;
}) {
  if (!adAssets) {
    return <p className="card-note">
      This bot does not report where its pictures are stored yet, so tiles name their file
      instead.{assetDir ? <> The files are in <span className="cell-mono">{assetDir}</span>.</> : null}
    </p>;
  }
  return <>
    <p className="card-note">
      {indexed > 0
        ? <>Pictures are served from the bot&rsquo;s asset index — the bucket its images were
            moved to, named in Firestore.</>
        : <>The bot&rsquo;s asset index lists no picture for this campaign, so tiles name their
            file instead.</>}
      {missing > 0 && indexed > 0
        ? <> {plural(missing, "picture")} below {missing === 1 ? "is" : "are"} declared by the
            campaign but absent from the index, so {missing === 1 ? "it has" : "they have"} no
            preview.</>
        : null}
    </p>
    {adAssets.note ? <p className="card-note">The index could not be read: {adAssets.note}</p> : null}
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
