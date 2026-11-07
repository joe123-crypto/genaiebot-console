"use client";

import { useState } from "react";
import { Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { IMAGES_SERVED, campaignImageSrc } from "@/src/lib/campaign-images";
import { plural } from "@/src/lib/format";

/**
 * One campaign's first picture, for a row in the campaigns list.
 *
 * A failed <img> paints the browser's own broken-image glyph, which no CSS can
 * suppress, so the element is dropped on error and the muted square with its
 * icon is what remains. That square is all a row can show until something
 * serves bytes.
 */
export function CampaignThumb({ slug, images }: { slug: string; images: string[] }) {
  const [broken, setBroken] = useState(false);
  const name = images[0];
  return (
    <span className="campaign-thumb" aria-hidden>
      <ImageIcon size={14} aria-hidden />
      {IMAGES_SERVED && name && !broken ? (
        <img src={campaignImageSrc(slug, name)} alt="" loading="lazy" decoding="async"
          onError={() => setBroken(true)} />
      ) : null}
      {images.length > 1 ? <span className="campaign-thumb-more">+{images.length - 1}</span> : null}
    </span>
  );
}

/**
 * A campaign's pictures, in the order the bot declares them.
 *
 * `writeUnavailableReason` is required rather than optional: nothing can store a
 * picture yet, so the add and remove controls are always rendered disabled with
 * the reason beside them. Making the reason impossible to omit is what keeps a
 * control from appearing that would silently do nothing.
 */
export function CampaignImages({
  slug, images, assetDir, writable, writeUnavailableReason,
}: {
  slug: string;
  images: string[];
  assetDir: string | null;
  writable: boolean;
  writeUnavailableReason: string;
}) {
  // A tile falls back to naming its file once the browser cannot fetch it,
  // which is both "no route serves bytes yet" and "the file left the checkout".
  const [broken, setBroken] = useState<string[]>([]);

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
          const shown = IMAGES_SERVED && !broken.includes(name);
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
                  <img src={campaignImageSrc(slug, name)} alt="" loading="lazy" decoding="async"
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
      {assetDir && images.length > 0 ? (
        <div className="caption-feedback">
          <p className="card-note">
            The console can list a campaign&rsquo;s pictures but cannot fetch them yet, so tiles name
            their file instead. The files themselves are in <span className="cell-mono">{assetDir}</span>.
          </p>
        </div>
      ) : null}
    </section>
  );
}
