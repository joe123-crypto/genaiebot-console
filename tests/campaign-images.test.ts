// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignImages } from "@/app/campaigns/_components/campaign-images";
import {
  MAX_IMAGE_BYTES,
  campaignAssetDir,
  campaignImageSrc,
  duplicateImageName,
  imagePickError,
} from "@/src/lib/campaign-images";

const REASON = "Picture changes need the companion bot update.";
const props = {
  slug: "borehole-drilling",
  images: ["borehole-1.jpg", "borehole-2.jpg"],
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
    mount({ images: ["only.png"] });
    expect(screen.getByText(/1 picture/).textContent).toContain("sent with every caption");
  });

  it("asks for no picture at all while nothing serves the files", () => {
    const view = mount();
    expect(view.container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getAllByText("Preview unavailable")).toHaveLength(2);
    // The name is the information a tile carries once pixels are impossible.
    expect(screen.getByText("borehole-1.jpg")).toBeTruthy();
  });

  it("says where the files are, so a picture can still be found by hand", () => {
    mount();
    expect(screen.getByText(props.assetDir)).toBeTruthy();
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
    mount({ images: ["only.png"] });
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
    mount({ images: [] });
    expect(screen.getByText(/declares no picture/).textContent).toContain("would stop before posting");
    expect(screen.queryByText(props.assetDir)).toBeNull();
  });
});

describe("picture helpers", () => {
  it("encodes both the slug and the file name into the image URL", () => {
    expect(campaignImageSrc("cv-promo", "cv ad.png")).toBe(
      "/api/campaigns/cv-promo/image/cv%20ad.png",
    );
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

/** The day something serves the files, `IMAGES_SERVED` flips and these paths —
 *  and only these — come alive. Pinning them now is what makes that one-line
 *  change safe. */
describe("campaign pictures, once the files are served", () => {
  async function mountServed(overrides = {}) {
    vi.resetModules();
    vi.doMock("@/src/lib/campaign-images", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/src/lib/campaign-images")>()),
      IMAGES_SERVED: true,
    }));
    const served = await import("@/app/campaigns/_components/campaign-images");
    return render(createElement(served.CampaignImages, { ...props, ...overrides }));
  }
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/src/lib/campaign-images");
  });

  it("points each tile at the campaign's own image route", async () => {
    const view = await mountServed();
    const images = [...view.container.querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "/api/campaigns/borehole-drilling/image/borehole-1.jpg",
      "/api/campaigns/borehole-drilling/image/borehole-2.jpg",
    ]);
  });

  it("drops a picture the browser cannot fetch, rather than show a broken one", async () => {
    const view = await mountServed();
    fireEvent.error(view.container.querySelector("img")!);
    expect(view.container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getAllByText("Preview unavailable")).toHaveLength(1);
    expect(screen.getByText("borehole-1.jpg")).toBeTruthy();
  });
});
