import { describe, expect, it } from "vitest";
import { attentionItems, daySlots } from "@/src/domains/console";
import type { Campaign, Overview } from "@/src/lib/types";

function campaign(partial: Partial<Campaign>): Campaign {
  return {
    slug: "demo",
    name: "demo-promo",
    enabled: true,
    cron: "0 9 * * *",
    hour: 9,
    minute: 0,
    timezone: "Africa/Harare",
    installer: "deploy/install-demo-promo.sh",
    script: "/tmp/post_ad.py",
    failureAlertTo: "+263000000000",
    legacyNames: [],
    timeoutSeconds: 7200,
    captions: ["hello"],
    tracking: { prefix: "DM" },
    images: [],
    targetCount: 5,
    weeklyCount: 0,
    accounts: { default: 5 },
    source: "git",
    error: null,
    ...partial,
  };
}

function overview(partial: Partial<Overview>): Overview {
  return {
    date: "2026-11-04",
    groupsByStatus: { active: 10 },
    groupTotal: 10,
    campaignTotal: 1,
    plannedSendsToday: 10,
    accounts: [{ id: "default", number: "+263000000000", isContact: true }],
    capsEnabled: true,
    campaigns: [campaign({})],
    ...partial,
  };
}

describe("attentionItems", () => {
  it("is empty when nothing needs a person", () => {
    expect(attentionItems(overview({}))).toEqual([]);
  });

  it("reports a campaign that failed to load", () => {
    const items = attentionItems(
      overview({ campaigns: [campaign({ error: "SyntaxError: bad" })] }),
    );
    expect(items[0]).toEqual({ label: "Campaigns failing to load", detail: "1" });
  });

  it("reports a campaign that targets nothing", () => {
    const items = attentionItems(overview({ campaigns: [campaign({ targetCount: 0 })] }));
    expect(items).toContainEqual({ label: "Campaigns with no groups", detail: "1" });
  });

  it("counts the group statuses an operator has to decide about", () => {
    const items = attentionItems(
      overview({
        groupsByStatus: { active: 4, "on-hold": 2, "admin-only": 3, "not-a-member": 1 },
      }),
    );
    expect(items).toContainEqual({ label: "Groups on hold", detail: "2" });
    expect(items).toContainEqual({ label: "Groups the bot cannot post in", detail: "3" });
    expect(items).toContainEqual({ label: "Groups the bot has left", detail: "1" });
  });

  it("flags caps being switched off, because that changes every send", () => {
    expect(attentionItems(overview({ capsEnabled: false }))).toContainEqual({
      label: "Daily ad caps are off",
    });
  });
});

describe("a switched-off campaign", () => {
  it("is not a slot in the day, because it installs no cron", () => {
    const slots = daySlots(
      overview({
        campaigns: [
          campaign({ slug: "runs", hour: 8, minute: 0 }),
          campaign({ slug: "off", hour: 9, minute: 0, enabled: false }),
        ],
      }),
    );
    expect(slots.map((slot) => slot.slug)).toEqual(["runs"]);
  });

  it("needs no attention for targeting nothing, being off on purpose", () => {
    const items = attentionItems(
      overview({ campaigns: [campaign({ targetCount: 0, enabled: false })] }),
    );
    expect(items).toEqual([]);
  });

  it("still reports a load failure, which is a real fault either way", () => {
    const items = attentionItems(
      overview({ campaigns: [campaign({ error: "boom", enabled: false })] }),
    );
    expect(items).toContainEqual({ label: "Campaigns failing to load", detail: "1" });
  });
});

describe("daySlots", () => {
  it("orders campaigns through the day and drops unparsable ones", () => {
    const slots = daySlots(
      overview({
        campaigns: [
          campaign({ slug: "late", hour: 17, minute: 6 }),
          campaign({ slug: "early", hour: 7, minute: 15 }),
          campaign({ slug: "broken", hour: null, minute: null }),
        ],
      }),
    );
    expect(slots.map((slot) => slot.slug)).toEqual(["early", "late"]);
    expect(slots[0].time).toBe("07:15");
  });
});
