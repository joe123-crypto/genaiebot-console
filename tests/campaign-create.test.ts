import { describe, it, expect } from "vitest";
import { CAMPAIGN_IMAGE_NAME_MAX, CAMPAIGN_REQUIRES_NONE, campaignCreateError, campaignDraftError, campaignImageFilename, campaignRequirements, campaignSlug, uploadError, type NewCampaign } from "@/src/domains/campaign-create";
import { canCreateCampaign } from "@/src/lib/write-capabilities";
import { daySlots, clashes } from "@/src/domains/schedule";
import { campaign } from "./fixtures/campaign-detail";
import type { Overview } from "@/src/lib/types";
import { validCampaign } from "./fixtures/new-campaign";
describe("campaign creation", () => {
  it("needs no advanced settings", () => { expect(campaignCreateError(validCampaign())).toBeUndefined(); expect(campaignSlug("Démonstration & Sale")).toBe("demonstration-sale"); expect(campaignSlug("New")).toBe("new-campaign"); });
  it.each([ ["blank caption", { captions: [" "] }], ["no pictures", { images: [] }], ["no groups", { groups: [] }],
    ["inactive-shaped group", { groups: [{ jid: "someone" }] }], ["invalid time", { schedule: { time: "25:10", timezone: "Africa/Harare", weekdays: [0] } }],
    ["timezone", { schedule: { time: "10:10", timezone: "nope", weekdays: [0] } }], ["empty weekdays", { schedule: { time: "10:10", timezone: "Africa/Harare", weekdays: [] } }],
    ["duplicate groups", { groups: [{ jid: "1@g.us" }, { jid: "1@g.us" }] }], ["tracking without prefix", { tracking: { number: "+263700000000" } }],
    ["outside group weekdays", { schedule: { time: "10:10", timezone: "Africa/Harare", weekdays: [0] }, groups: [{ jid: "1@g.us", weekdays: [1] }] }] ])("rejects %s", (_, patch) => {
      expect(campaignCreateError({ ...validCampaign(), ...patch })).toBeTruthy();
    });
  it("takes a campaign with no pictures or groups when the bot says it can, and still caps pictures at 20", () => {
    const bare = { ...validCampaign(), images: [], groups: [] };
    expect(campaignCreateError(bare)).toBe("Choose between 1 and 20 pictures.");
    expect(campaignCreateError({ ...bare, images: validCampaign().images })).toBe("Select at least one active group, each only once.");
    expect(campaignCreateError(bare, undefined, CAMPAIGN_REQUIRES_NONE)).toBeUndefined();
    expect(campaignCreateError(bare, undefined, { pictures: false, groups: true })).toBe("Select at least one active group, each only once.");
    const image = validCampaign().images[0];
    const many = Array.from({ length: 21 }, (_, n) => ({ ...image, filename: `p${n}.png`, key: image.key.replace(/[a-f0-9]{64}/, String(n).padStart(64, "0")) }));
    expect(campaignCreateError({ ...bare, images: many }, undefined, CAMPAIGN_REQUIRES_NONE)).toBe("Choose at most 20 pictures.");
    expect(campaignCreateError({ ...bare, groups: [{ jid: "1@g.us" }, { jid: "1@g.us" }] }, undefined, CAMPAIGN_REQUIRES_NONE))
      .toBe("Select each group only once.");
  });
  it("reads a bot that says nothing about optional pictures or groups as needing both", () => {
    expect(campaignRequirements(undefined)).toEqual({ pictures: true, groups: true });
    expect(campaignRequirements({ campaignCreation: {} })).toEqual({ pictures: true, groups: true });
    expect(campaignRequirements({ campaignCreation: { picturesOptional: true } })).toEqual({ pictures: false, groups: true });
    expect(campaignRequirements({ campaignCreation: { picturesOptional: true, groupsOptional: true } })).toEqual({ pictures: false, groups: false });
  });
  it("has no ceiling on how many groups a campaign posts to", () => {
    // The bot used to refuse more than 100, and more than its two-hour job
    // reached at full spacing. It now gives a bigger campaign a longer run.
    const groups = Array.from({ length: 250 }, (_, n) => ({ jid: `1203639${String(n).padStart(11, "0")}@g.us` }));
    expect(campaignCreateError({ ...validCampaign(), groups })).toBeUndefined();
  });
  it("accepts the details on their own, and still demands captions to create", () => {
    const { captions, ...draft } = validCampaign();
    expect(captions).toBeTruthy();
    expect(campaignDraftError(draft)).toBeUndefined();
    expect(campaignCreateError(draft)).toBe("Enter text for every caption and keep at least one variant.");
    expect(campaignDraftError({ ...draft, groups: [] })).toBeTruthy();
    expect(campaignDraftError({ ...draft, name: "" })).toBeTruthy();
    expect(campaignCreateError({ ...draft, captions: ["Still too long", "x".repeat(61 * 1024)] }))
      .toBe("The campaign configuration is too large. Shorten the captions or notes.");
  });
  it("validates image ownership, types, limits and duplicates", () => {
    const input = validCampaign(), image = input.images[0];
    expect(uploadError({ ...image, bytes: 6 * 1024 * 1024 }, "demo")).toBeUndefined();
    expect(uploadError({ ...image, bytes: 6 * 1024 * 1024 + 1 }, "demo")).toBeTruthy();
    expect(uploadError({ ...image, contentType: "image/webp" }, "demo")).toBeTruthy();
    expect(uploadError(image, "other")).toBeTruthy();
    expect(campaignCreateError({ ...input, images: [image, image] })).toBeTruthy();
  });
  it("keeps a picture name short enough for the bot to cache it", () => {
    // The name that broke borehole-drilling-2: the bot caches
    // "<digest>-<filename>" in one path component, and this one took the whole
    // path past 255 bytes, so every send died before posting anything.
    const advert = "Borehole-Drilling---Solar-Installation_-Complete-Water-and-Power-Solutions-for-Zimbabwe-Businesses--------__Are-you-ready-to-transition-to-complete-utility-independence_-Whether-it-s-for-your-home--farm--or-commercial-property--ge.jpeg";
    const sha = "a".repeat(64);
    const fitted = campaignImageFilename(advert, sha, "image/jpeg");
    expect(fitted.length).toBeLessThanOrEqual(CAMPAIGN_IMAGE_NAME_MAX);
    expect(fitted.startsWith("Borehole-Drilling")).toBe(true);
    expect(fitted.endsWith(".jpg")).toBe(true);
    const input = validCampaign(), image = input.images[0];
    expect(uploadError({ ...image, filename: fitted }, "demo")).toBeUndefined();
    expect(uploadError({ ...image, filename: advert }, "demo")).toBeTruthy();
    // A usable name is still the operator's own, and an unusable one still
    // falls back to the digest rather than being trimmed into nonsense.
    expect(campaignImageFilename("borehole.JPEG", sha, "image/jpeg")).toBe("borehole.jpeg");
    expect(campaignImageFilename("...", sha, "image/png")).toBe(`image-${sha.slice(0, 12)}.png`);
  });
  it("gates on all bot capabilities and live config", () => {
    const writes = { enabled: true, affectsProduction: true, fields: {}, delete: [], campaignCreation: { create: true, images: true, scheduling: true } };
    expect(canCreateCampaign(true, writes).allowed).toBe(true);
    expect(canCreateCampaign(false, writes).allowed).toBe(false);
    expect(canCreateCampaign(true, undefined).allowed).toBe(false);
    expect(canCreateCampaign(true, { ...writes, affectsProduction: false }).allowed).toBe(false);
    expect(canCreateCampaign(true, { ...writes, campaignCreation: { ...writes.campaignCreation, scheduling: false } }).allowed).toBe(false);
  });
  it("identifies missing image configuration on an updated bot", () => {
    const writes = { enabled: true, affectsProduction: true, fields: {}, delete: [], campaignCreation: { create: true, images: false, scheduling: true } };
    const gate = canCreateCampaign(true, writes);
    expect(gate.allowed).toBe(false);
    if (gate.allowed) throw new Error("Expected image configuration to block creation");
    expect(gate.reason).toContain("GENAIE_AD_ASSETS_SOURCE=r2");
    expect(gate.reason).toContain("GENAIE_AD_ASSETS_BASE_URL");
    expect(gate.reason).not.toContain("Deploy the companion bot");
  });
  it("keeps the upgrade explanation when creation or scheduling support is missing", () => {
    for (const support of [undefined, { create: false, images: false, scheduling: true }, { create: true, images: false, scheduling: false }]) {
      const gate = canCreateCampaign(true, { enabled: true, affectsProduction: true, fields: {}, delete: [], campaignCreation: support });
      expect(gate.allowed).toBe(false);
      if (gate.allowed) throw new Error("Expected missing bot support to block creation");
      expect(gate.reason).toContain("Deploy the companion bot");
    }
  });
  it("uses normalized schedule time and excludes days without an occurrence", () => {
    const overview = { campaigns: [{ ...campaign, scheduleMinutes: 600 }, { ...campaign, slug: "off-day", scheduleMinutes: null }] } as unknown as Overview;
    expect(daySlots(overview).map((slot) => slot.time)).toEqual(["10:00"]);
  });
  it("finds overlap on a campaign's minority line", () => {
    const overview = { campaigns: [{ ...campaign, hour: 9, minute: 0, accounts: { default: 8, ads: 2 }, targetCount: 10 },
      { ...campaign, slug: "second", hour: 9, minute: 5, accounts: { ads: 2 }, targetCount: 2 }] } as unknown as Overview;
    expect(clashes(daySlots(overview)).map((clash) => clash.account)).toContain("ads");
  });
});
