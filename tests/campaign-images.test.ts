// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CampaignImages, CampaignThumb } from "@/app/campaigns/_components/campaign-images";
import {
  MAX_IMAGE_BYTES,
  assetFor,
  campaignAssetDir,
  campaignImageSrc,
  duplicateImageName,
  imagePickError,
} from "@/src/lib/campaign-images";
import type { AdAssets, CampaignAsset } from "@/src/lib/types";

const REASON = "Picture changes need the companion bot update.";
const BUCKET = "https://pub-example.r2.dev/ads/borehole-drilling";

function asset(filename: string, digest: string, rank: number): CampaignAsset {
  return { filename, url: `${BUCKET}/${digest}.jpg`, sha256: digest.repeat(32),
    bytes: 243016, contentType: "image/jpeg", rank };
}
const assets = [asset("borehole-1.jpg", "aa", 10), asset("borehole-2.jpg", "bb", 20)];
const adAssets: AdAssets = { mode: "r2", source: "firestore",
  fetchedAt: "2026-11-09T00:00:00Z", note: null };

const props = {
  images: ["borehole-1.jpg", "borehole-2.jpg"],
  assets,
  adAssets,
  assetDir: "/checkout/workspace/cron/borehole-drilling-promo/assets",
  writable: true,
  writeUnavailableReason: REASON,
};
function mount(overrides = {}) {
  return render(createElement(CampaignImages, { ...props, ...overrides }));
}
function file(name: string, type: string, size: number) {
  return new File([new Uint8Array(size)], name, { type });
}
const sources = (view: { container: HTMLElement }) =>
  [...view.container.querySelectorAll("img")].map((image) => image.getAttribute("src"));
afterEach(cleanup);

describe("campaign pictures", () => {
  it("names every picture in the declared set", () => {
    const view = mount();
    expect(view.container.querySelectorAll("figure.campaign-image")).toHaveLength(2);
    expect(screen.getByText("borehole-1.jpg")).toBeTruthy();
    expect(screen.getByText("borehole-2.jpg")).toBeTruthy();
    expect(screen.getByText("Picture 1")).toBeTruthy();
    expect(screen.getByText("Picture 2")).toBeTruthy();
  });

  it("explains daily rotation only when there is more than one picture", () => {
    mount();
    expect(screen.getByText(/2 pictures/).textContent).toContain("one of them per day");
    cleanup();
    mount({ images: ["only.png"], assets: [] });
    expect(screen.getByText(/1 picture/).textContent).toContain("sent with every caption");
  });

  it("shows each picture from the index, in the order the bot declares them", () => {
    const view = mount();
    expect(sources(view)).toEqual([`${BUCKET}/aa.jpg`, `${BUCKET}/bb.jpg`]);
    expect(screen.queryByText("Preview unavailable")).toBeNull();
  });

  it("drops a picture the browser cannot fetch, rather than show a broken one", () => {
    const view = mount();
    fireEvent.error(view.container.querySelector("img")!);
    expect(sources(view)).toEqual([`${BUCKET}/bb.jpg`]);
    expect(screen.getAllByText("Preview unavailable")).toHaveLength(1);
    // The name is the information a tile carries once pixels are impossible.
    expect(screen.getByText("borehole-1.jpg")).toBeTruthy();
  });

  it("asks for no picture at all when the index does not name one", () => {
    const view = mount({ assets: [] });
    expect(view.container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getAllByText("Preview unavailable")).toHaveLength(2);
    expect(screen.getByText(/lists no picture for this campaign/)).toBeTruthy();
  });

  it("says how many declared pictures the index has never heard of", () => {
    mount({ assets: [assets[0]] });
    expect(sources({ container: document.body })).toEqual([`${BUCKET}/aa.jpg`]);
    expect(screen.getByText(/1 picture below is declared by the campaign but absent/)).toBeTruthy();
  });

  it("shows nothing for an entry the bot could not give an address for", () => {
    const view = mount({ assets: [{ ...assets[0], url: null }, assets[1]] });
    expect(sources(view)).toEqual([`${BUCKET}/bb.jpg`]);
  });

  it("says plainly that a run still posts the baked copy before the cutover", () => {
    mount({ adAssets: { ...adAssets, mode: "repo" } });
    const note = screen.getByText(/still attaches the copy baked into its container/);
    expect(note.textContent).toContain("not the one shown here");
    expect(note.textContent).toContain("repo");
    expect(screen.getByText(props.assetDir)).toBeTruthy();
  });

  it("does not contrast the baked copy with a picture it is not showing", () => {
    mount({ assets: [], adAssets: { ...adAssets, mode: "repo" } });
    const note = screen.getByText(/still attaches the copy baked into its container/);
    expect(note.textContent).not.toContain("not the one shown here");
  });

  it("does not claim a baked copy once the bot posts what it shows", () => {
    mount();
    expect(screen.queryByText(/baked into its container/)).toBeNull();
  });

  it("says a mirrored set is the deploy's, not the live index", () => {
    mount({ adAssets: { ...adAssets, source: "mirror",
      note: "firestore.googleapis.com answered HTTP 429" } });
    // The pictures are real and shown, so it must not say the index failed flat.
    expect(sources({ container: document.body })).toHaveLength(2);
    expect(screen.getByText(/set committed at the bot’s last deploy/)).toBeTruthy();
    expect(screen.queryByText(/The index could not be read/)).toBeNull();
    expect(screen.getByText(/Why the live index was not read/).textContent).toContain("429");
  });

  it("repeats the bot's own account of an index it could not read", () => {
    mount({ assets: [], adAssets: { ...adAssets, source: null, note: "no service account configured" } });
    expect(screen.getByText(/no service account configured/)).toBeTruthy();
  });

  it("says a bot too old to report the index is why, not that there are no pictures", () => {
    mount({ assets: undefined, adAssets: undefined });
    expect(screen.getByText(/does not report where its pictures are stored yet/)).toBeTruthy();
    expect(screen.getAllByText("Preview unavailable")).toHaveLength(2);
  });

  it("offers add and remove, disabled, with the reason they are off", () => {
    mount();
    const add = screen.getByRole("button", { name: /Add picture/ }) as HTMLButtonElement;
    const remove = screen.getByRole("button", { name: "Remove picture 2" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe(REASON);
    expect(remove.disabled).toBe(true);
    expect(remove.title).toBe(REASON);
    expect(screen.getByText(REASON)).toBeTruthy();
  });

  it("explains the single picture a campaign cannot go below", () => {
    mount({ images: ["only.png"], assets: [] });
    const remove = screen.getByRole("button", { name: "Remove picture 1" }) as HTMLButtonElement;
    expect(remove.title).toBe("Keep at least one picture");
  });

  it("shows no controls at all in read-only mode", () => {
    mount({ writable: false });
    expect(screen.queryByRole("button", { name: /Add picture/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove picture 1" })).toBeNull();
    expect(screen.queryByText(REASON)).toBeNull();
    expect(screen.getByText("borehole-1.jpg")).toBeTruthy();
  });

  it("warns when a campaign declares no picture, because the send would stop", () => {
    mount({ images: [], assets: [] });
    expect(screen.getByText(/declares no picture/).textContent).toContain("would stop before posting");
    expect(screen.queryByText(props.assetDir)).toBeNull();
  });
});

describe("the campaigns list thumbnail", () => {
  it("shows the first picture and counts the rest", () => {
    const view = render(createElement(CampaignThumb, { images: props.images, assets }));
    expect(sources(view)).toEqual([`${BUCKET}/aa.jpg`]);
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("falls back to its icon when there is nothing to show", () => {
    const view = render(createElement(CampaignThumb, { images: props.images, assets: [] }));
    expect(view.container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("drops a thumbnail the browser cannot fetch", () => {
    const view = render(createElement(CampaignThumb, { images: props.images, assets }));
    fireEvent.error(view.container.querySelector("img")!);
    expect(view.container.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("picture helpers", () => {
  it("joins a declared name to its index entry, and reports the address", () => {
    expect(assetFor(assets, "borehole-2.jpg")).toBe(assets[1]);
    expect(assetFor(assets, "nowhere.jpg")).toBeUndefined();
    expect(campaignImageSrc(assets, "borehole-1.jpg")).toBe(`${BUCKET}/aa.jpg`);
    expect(campaignImageSrc(assets, "nowhere.jpg")).toBeUndefined();
    // An entry the bot could give no address for is nothing to load, not "".
    expect(campaignImageSrc([{ ...assets[0], url: null }], "borehole-1.jpg")).toBeUndefined();
  });

  it("refuses the wrong kind of file before complaining about its size", () => {
    expect(imagePickError(file("notes.txt", "text/plain", 10))).toContain("not a JPEG, PNG or WebP");
    expect(imagePickError(file("huge.png", "image/png", MAX_IMAGE_BYTES + 1))).toContain("larger than 5 MB");
    expect(imagePickError(file("fine.jpg", "image/jpeg", 1024))).toBeUndefined();
  });

  it("spots a name declared twice, which would just post it twice as often", () => {
    expect(duplicateImageName(["a.png", "b.png", "a.png"])).toBe("a.png");
    expect(duplicateImageName(["a.png", "b.png"])).toBeUndefined();
  });

  it("derives the asset directory from the script path the bridge reports", () => {
    expect(campaignAssetDir("/checkout/workspace/cron/cv-promo/post_cv_ad.py")).toBe(
      "/checkout/workspace/cron/cv-promo/assets",
    );
    expect(campaignAssetDir(null)).toBeNull();
    expect(campaignAssetDir("post_ad.py")).toBeNull();
  });
});
