import { describe, it, expect } from "vitest";
import { campaignCreateError, campaignSlug, uploadError, type NewCampaign } from "@/src/domains/campaign-create";
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
    ["boolean timeout", { timeoutSeconds: true }], ["tracking without prefix", { tracking: { number: "+263700000000" } }],
    ["outside group weekdays", { schedule: { time: "10:10", timezone: "Africa/Harare", weekdays: [0] }, groups: [{ jid: "1@g.us", weekdays: [1] }] }] ])("rejects %s", (_, patch) => {
      expect(campaignCreateError({ ...validCampaign(), ...patch })).toBeTruthy();
    });
  it("validates image ownership, types, limits and duplicates", () => {
    const input = validCampaign(), image = input.images[0];
    expect(uploadError({ ...image, bytes: 6 * 1024 * 1024 }, "demo")).toBeUndefined();
    expect(uploadError({ ...image, bytes: 6 * 1024 * 1024 + 1 }, "demo")).toBeTruthy();
    expect(uploadError({ ...image, contentType: "image/webp" }, "demo")).toBeTruthy();
    expect(uploadError(image, "other")).toBeTruthy();
    expect(campaignCreateError({ ...input, images: [image, image] })).toBeTruthy();
  });
  it("gates on all bot capabilities and live config", () => {
    const writes = { enabled: true, affectsProduction: true, fields: {}, delete: [], campaignCreation: { create: true, images: true, scheduling: true } };
    expect(canCreateCampaign(true, writes).allowed).toBe(true);
    expect(canCreateCampaign(false, writes).allowed).toBe(false);
    expect(canCreateCampaign(true, undefined).allowed).toBe(false);
    expect(canCreateCampaign(true, { ...writes, affectsProduction: false }).allowed).toBe(false);
    expect(canCreateCampaign(true, { ...writes, campaignCreation: { ...writes.campaignCreation, scheduling: false } }).allowed).toBe(false);
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
