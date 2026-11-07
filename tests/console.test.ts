import { describe, expect, it } from "vitest";
import {
  attentionItems,
  clashes,
  daySlots,
  lineOf,
  lineSummaries,
  nextUp,
  runEndsAt,
  runningNow,
  withTimes,
} from "@/src/domains/console";
import type { DaySlot } from "@/src/domains/schedule";
import { clockLabel } from "@/src/lib/format";
import type { Campaign, Group, Overview } from "@/src/lib/types";

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

function group(partial: Partial<Group>): Group {
  return {
    jid: "1@g.us",
    name: "A group",
    source: "whatsapp",
    status: "active",
    activity: "normal",
    account: "default",
    dailyCapOverride: null,
    promos: [],
    weekly: {},
    note: null,
    cap: 2,
    replyScore: null,
    allowedToday: [],
    ...partial,
  };
}

describe("lineSummaries", () => {
  it("counts only the campaigns a line actually posts", () => {
    const [line] = lineSummaries(
      overview({}),
      [
        group({ jid: "1@g.us", promos: ["genaie", "cv"] }),
        group({ jid: "2@g.us", promos: ["cv"] }),
      ],
      ["cv"],
    );
    expect(line.campaignCount).toBe(1);
  });

  it("still lists the switched-off campaign, flagged, because it is configured", () => {
    const [line] = lineSummaries(
      overview({}),
      [group({ promos: ["genaie", "cv"] })],
      ["cv"],
    );
    expect(line.promos.map((promo) => [promo.slug, promo.off])).toEqual(
      expect.arrayContaining([
        ["genaie", false],
        ["cv", true],
      ]),
    );
  });

  it("reports nothing posted when every configured campaign is off", () => {
    const [line] = lineSummaries(overview({}), [group({ promos: ["cv"] })], ["cv"]);
    expect(line.campaignCount).toBe(0);
    expect(line.promos).toHaveLength(1);
  });

  it("ignores groups belonging to another line, and groups not advertising", () => {
    const [line] = lineSummaries(
      overview({}),
      [
        group({ jid: "1@g.us", promos: ["genaie"] }),
        group({ jid: "2@g.us", account: "ads", promos: ["genaie", "fruit-trees"] }),
        group({ jid: "3@g.us", status: "on-hold", promos: ["skylight-solar"] }),
      ],
      [],
    );
    expect(line.groupCount).toBe(2);
    expect(line.advertisingCount).toBe(1);
    expect(line.promos.map((promo) => promo.slug)).toEqual(["genaie"]);
  });
});

describe("what is running now", () => {
  // 5 groups is a 20 min worst case, so the 08:00 slot runs to 08:20.
  const slots = daySlots(
    overview({
      campaigns: [
        campaign({ slug: "morning", hour: 8, minute: 0 }),
        campaign({ slug: "afternoon", hour: 14, minute: 0 }),
      ],
    }),
  );

  it("ends a run at its worst case, where the overlap rule ends it too", () => {
    expect(runEndsAt(slots[0])).toBe(8 * 60 + 20);
  });

  it("marks a run from its own start minute", () => {
    expect(runningNow(slots, 8 * 60).map((slot) => slot.slug)).toEqual(["morning"]);
  });

  it("releases it the minute its worst case is over", () => {
    expect(runningNow(slots, 8 * 60 + 19).map((slot) => slot.slug)).toEqual(["morning"]);
    expect(runningNow(slots, 8 * 60 + 20)).toEqual([]);
  });

  it("names every run covering now, which is the overlap the banner warns about", () => {
    const overlapping = daySlots(
      overview({
        campaigns: [
          campaign({ slug: "first", hour: 8, minute: 0, targetCount: 46 }),
          campaign({ slug: "second", hour: 8, minute: 30, targetCount: 5 }),
        ],
      }),
    );
    expect(runningNow(overlapping, 8 * 60 + 40).map((slot) => slot.slug)).toEqual([
      "first",
      "second",
    ]);
  });

  it("has nothing running before the day's first slot", () => {
    expect(runningNow(slots, 6 * 60)).toEqual([]);
    expect(nextUp(slots, 6 * 60)?.slug).toBe("morning");
  });

  it("has nothing next once the last slot has started", () => {
    expect(nextUp(slots, 14 * 60)).toBeUndefined();
  });
});

/** Five groups is a 20-minute worst case: 900s + 4*60s + 5*12s. */
function slot(slug: string, minutes: number, partial: Partial<DaySlot> = {}): DaySlot {
  return {
    slug,
    name: `${slug}-promo`,
    time: clockLabel(minutes),
    minutes,
    targetCount: 5,
    accounts: { default: 5 },
    ...partial,
  };
}

describe("which line a slot runs on", () => {
  it("picks the line carrying most of the groups", () => {
    expect(lineOf(slot("a", 540, { accounts: { default: 2, ads: 9 } }))).toBe("ads");
  });

  it("falls back to the default line when nothing is tallied", () => {
    expect(lineOf(slot("a", 540, { accounts: {} }))).toBe("default");
  });
});

describe("overlapping runs on one line", () => {
  it("reports a run that is still going when the next one starts", () => {
    const found = clashes([slot("alpha", 540), slot("beta", 550)]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ account: "default", finishes: 560 });
    expect(found[0].current.slug).toBe("alpha");
    expect(found[0].next.slug).toBe("beta");
  });

  it("stays quiet once the earlier run has finished", () => {
    expect(clashes([slot("alpha", 540), slot("beta", 570)])).toEqual([]);
  });

  it("lets two lines run at the same time", () => {
    const found = clashes([
      slot("alpha", 540),
      slot("beta", 550, { accounts: { ads: 5 } }),
    ]);
    expect(found).toEqual([]);
  });

  it("still finds the clash when a dragged time crosses its neighbour", () => {
    // Deliberately out of order: a bar dragged past the next one arrives here
    // before it, and comparing that unsorted would miss the collision.
    const found = clashes([slot("beta", 550), slot("alpha", 540)]);
    expect(found.map((clash) => [clash.current.slug, clash.next.slug])).toEqual([
      ["alpha", "beta"],
    ]);
  });
});

describe("drafted times", () => {
  it("relabels and reorders the slots it moves", () => {
    const moved = withTimes([slot("alpha", 540), slot("beta", 600)], { alpha: 630 });
    expect(moved.map((entry) => [entry.slug, entry.time])).toEqual([
      ["beta", "10:00"],
      ["alpha", "10:30"],
    ]);
  });

  it("leaves a slot alone when its time has not changed", () => {
    const slots = [slot("alpha", 540)];
    expect(withTimes(slots, { alpha: 540 })[0]).toBe(slots[0]);
  });
});
