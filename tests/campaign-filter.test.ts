import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMPAIGN_FILTER,
  campaignFilterQuery,
  campaignLineOptions,
  campaignSlotBucket,
  campaignSlotOptions,
  filterCampaigns,
  hasNoGroups,
  isDefaultCampaignFilter,
  isFailing,
  isRunning,
  matchesCampaignQuery,
  parseCampaignFilter,
  usesLine,
  type CampaignFilter,
} from "@/src/domains/campaign-filter";
import { attentionItems } from "@/src/domains/console";
import type { Campaign, Overview } from "@/src/lib/types";

function campaign(overrides: Partial<Campaign> & Pick<Campaign, "slug">): Campaign {
  return {
    name: `${overrides.slug}-promo`,
    enabled: true,
    cron: "0 7 * * *",
    hour: 7,
    minute: 15,
    timezone: "Africa/Harare",
    installer: "install.sh",
    script: "post_ad.py",
    failureAlertTo: "",
    legacyNames: [],
    timeoutSeconds: 900,
    captions: ["one"],
    tracking: {},
    images: [],
    targetCount: 10,
    weeklyCount: 0,
    accounts: { default: 10 },
    source: "git",
    error: null,
    ...overrides,
  };
}

const borehole = campaign({
  slug: "borehole-drilling",
  hour: 7,
  minute: 15,
  tracking: { prefix: "BH" },
  accounts: { default: 33, ads: 11 },
  targetCount: 44,
  weeklyCount: 1,
});
const lighting = campaign({
  slug: "industrial-lighting",
  hour: 10,
  minute: 5,
  tracking: { prefix: "IL" },
  accounts: { ads: 13, default: 1 },
  targetCount: 14,
});
const cv = campaign({
  slug: "cv",
  hour: 11,
  minute: 39,
  enabled: false,
  tracking: { prefix: "CV" },
  targetCount: 45,
  weeklyCount: 1,
});
const leads = campaign({ slug: "genaie-leads", hour: 17, minute: 6, tracking: { prefix: "GL" } });
const campaigns = [borehole, lighting, cv, leads];

function filter(overrides: Partial<CampaignFilter> = {}): CampaignFilter {
  return { ...DEFAULT_CAMPAIGN_FILTER, ...overrides };
}
const slugs = (rows: Campaign[]) => rows.map((row) => row.slug);

describe("the predicates", () => {
  it("tells running from off and from broken", () => {
    expect(isRunning(borehole)).toBe(true);
    expect(isRunning(cv)).toBe(false);
    expect(isRunning(campaign({ slug: "x", error: "boom" }))).toBe(false);
  });

  it("reports a load failure whether or not the campaign is switched off", () => {
    // A broken campaign is a fault either way: the copy will not load.
    expect(isFailing(campaign({ slug: "x", error: "boom" }))).toBe(true);
    expect(isFailing(campaign({ slug: "x", error: "boom", enabled: false }))).toBe(true);
    expect(isFailing(borehole)).toBe(false);
  });

  it("counts targeting nothing only for a campaign meant to post", () => {
    expect(hasNoGroups(campaign({ slug: "x", targetCount: 0 }))).toBe(true);
    // Off on purpose, so it is a decision and not a fault.
    expect(hasNoGroups(campaign({ slug: "x", targetCount: 0, enabled: false }))).toBe(false);
    // Already reported as a load failure; do not complain twice.
    expect(hasNoGroups(campaign({ slug: "x", targetCount: 0, error: "boom" }))).toBe(false);
  });

  it("asks whether a campaign uses a line, not whether it is the only one", () => {
    // The difference from a group, which has exactly one line.
    expect(usesLine(borehole, "default")).toBe(true);
    expect(usesLine(borehole, "ads")).toBe(true);
    expect(usesLine(leads, "ads")).toBe(false);
  });

  it("buckets a slot by the hour it fires, and names an unreadable one", () => {
    expect(campaignSlotBucket({ hour: 7 })).toBe("morning");
    expect(campaignSlotBucket({ hour: 11 })).toBe("morning");
    expect(campaignSlotBucket({ hour: 12 })).toBe("afternoon");
    expect(campaignSlotBucket({ hour: 16 })).toBe("afternoon");
    expect(campaignSlotBucket({ hour: 17 })).toBe("evening");
    expect(campaignSlotBucket({ hour: null })).toBe("unscheduled");
  });
});

describe("the status views agree with the attention card", () => {
  function overview(campaignList: Campaign[]): Overview {
    return {
      date: "2026-11-08",
      groupsByStatus: { active: 1 },
      groupTotal: 1,
      campaignTotal: campaignList.length,
      plannedSendsToday: 0,
      accounts: [],
      capsEnabled: true,
      campaigns: campaignList,
    };
  }

  it("shows exactly the campaigns the card counted as having no groups", () => {
    // The card links to this view, so a disagreement would be a link to a
    // table that contradicts the number printed beside it.
    const rows = [campaign({ slug: "empty", targetCount: 0 }), borehole];
    const counted = attentionItems(overview(rows)).find(
      (item) => item.label === "Campaigns with no groups",
    );
    const shown = filterCampaigns(rows, filter({ status: "no-groups" }));
    expect(counted?.detail).toBe(String(shown.length));
    expect(counted?.href).toBe("/campaigns?status=no-groups");
    expect(slugs(shown)).toEqual(["empty"]);
  });

  it("shows exactly the campaigns the card counted as failing", () => {
    const rows = [campaign({ slug: "broken", error: "SyntaxError" }), borehole];
    const counted = attentionItems(overview(rows)).find(
      (item) => item.label === "Campaigns failing to load",
    );
    const shown = filterCampaigns(rows, filter({ status: "failing" }));
    expect(counted?.detail).toBe(String(shown.length));
    expect(counted?.href).toBe("/campaigns?status=failing");
  });
});

describe("parseCampaignFilter", () => {
  it("defaults an empty query string", () => {
    expect(parseCampaignFilter({})).toEqual(DEFAULT_CAMPAIGN_FILTER);
  });

  it("reads a URLSearchParams as well as a searchParams object", () => {
    const expected = filter({ q: "bore", status: "off" });
    expect(parseCampaignFilter({ q: "bore", status: "off" })).toEqual(expected);
    expect(parseCampaignFilter(new URLSearchParams("q=bore&status=off"))).toEqual(expected);
  });

  it("falls back to every campaign when a value is junk", () => {
    expect(parseCampaignFilter({ status: "../../etc" }).status).toBe("all");
    expect(parseCampaignFilter({ cadence: "hourly" }).cadence).toBe("");
    expect(parseCampaignFilter({ slot: "midnight" }).slot).toBe("");
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseCampaignFilter({ status: ["off", "running"] }).status).toBe("off");
  });

  it("keeps a line that matches no campaign", () => {
    // Parsed before the rows are known, so a shared link must survive it.
    expect(parseCampaignFilter({ line: "retired" }).line).toBe("retired");
  });

  it.each([
    filter(),
    filter({ q: "borehole" }),
    filter({ status: "no-groups" }),
    filter({ line: "ads", cadence: "weekly", slot: "morning" }),
    filter({ q: "a b", status: "running", line: "default", cadence: "daily", slot: "evening" }),
  ])("round-trips through the query string", (original) => {
    expect(parseCampaignFilter(campaignFilterQuery(original))).toEqual(original);
  });

  it("writes nothing for an unfiltered table", () => {
    expect(campaignFilterQuery(DEFAULT_CAMPAIGN_FILTER).toString()).toBe("");
    expect(isDefaultCampaignFilter(DEFAULT_CAMPAIGN_FILTER)).toBe(true);
    expect(isDefaultCampaignFilter(filter({ slot: "morning" }))).toBe(false);
  });
});

describe("searching", () => {
  it("matches the displayed title, the id beneath it and the ref badge", () => {
    expect(matchesCampaignQuery(borehole, "Borehole Drilling")).toBe(true);
    expect(matchesCampaignQuery(borehole, "borehole-drilling")).toBe(true);
    expect(matchesCampaignQuery(borehole, "borehole-drilling-promo")).toBe(true);
    expect(matchesCampaignQuery(borehole, "bh")).toBe(true);
    expect(matchesCampaignQuery(lighting, "bh")).toBe(false);
  });

  it("is a plain substring, so a short query can reach more than one row", () => {
    // "il" is in both "BH"-less lighting and in "dr-il-ling". Worth pinning:
    // it is the behaviour, not a bug, and the facets are there to narrow.
    expect(matchesCampaignQuery(borehole, "il")).toBe(true);
    expect(matchesCampaignQuery(lighting, "il")).toBe(true);
  });

  it("ignores case and matches everything on a blank query", () => {
    expect(matchesCampaignQuery(borehole, "BOREHOLE")).toBe(true);
    expect(matchesCampaignQuery(borehole, "   ")).toBe(true);
  });

  it("treats the query as text, not a pattern", () => {
    expect(matchesCampaignQuery(borehole, "borehole.drilling")).toBe(false);
  });

  it("finds the acronym campaign by the title it actually shows", () => {
    // campaignTitle uppercases "cv", so searching "CV" has to reach it.
    expect(matchesCampaignQuery(cv, "cv")).toBe(true);
  });
});

describe("filterCampaigns", () => {
  it("narrows by each facet on its own", () => {
    expect(slugs(filterCampaigns(campaigns, filter({ status: "off" })))).toEqual(["cv"]);
    expect(slugs(filterCampaigns(campaigns, filter({ status: "running" })))).toEqual([
      "borehole-drilling",
      "industrial-lighting",
      "genaie-leads",
    ]);
    expect(slugs(filterCampaigns(campaigns, filter({ cadence: "weekly" })))).toEqual([
      "borehole-drilling",
      "cv",
    ]);
    expect(slugs(filterCampaigns(campaigns, filter({ slot: "evening" })))).toEqual(["genaie-leads"]);
  });

  it("matches a line a campaign shares with another", () => {
    expect(slugs(filterCampaigns(campaigns, filter({ line: "ads" })))).toEqual([
      "borehole-drilling",
      "industrial-lighting",
    ]);
    expect(slugs(filterCampaigns(campaigns, filter({ line: "default" })))).toEqual([
      "borehole-drilling",
      "industrial-lighting",
      "cv",
      "genaie-leads",
    ]);
  });

  it("ands the facets and the search together", () => {
    expect(slugs(filterCampaigns(campaigns, filter({ line: "ads", slot: "morning" })))).toEqual([
      "borehole-drilling",
      "industrial-lighting",
    ]);
    expect(filterCampaigns(campaigns, filter({ line: "ads", status: "off" }))).toEqual([]);
    expect(slugs(filterCampaigns(campaigns, filter({ q: "lighting", line: "ads" })))).toEqual([
      "industrial-lighting",
    ]);
  });

  it("keeps the order the bridge sent, which is the order they run", () => {
    expect(slugs(filterCampaigns(campaigns, DEFAULT_CAMPAIGN_FILTER))).toEqual(slugs(campaigns));
  });
});

describe("facet options", () => {
  it("lists every line any campaign uses, once", () => {
    expect(campaignLineOptions(campaigns, "")).toEqual([
      { value: "ads", label: "ads" },
      { value: "default", label: "default" },
    ]);
  });

  it("keeps a selected line whose campaigns are gone, flagged", () => {
    expect(campaignLineOptions(campaigns, "retired")).toContainEqual({
      value: "retired",
      label: "retired (no campaigns)",
      stale: true,
    });
  });

  it("offers slots in the order of the day, not alphabetically", () => {
    // Alphabetical would be afternoon, evening, morning.
    const withAfternoon = [...campaigns, campaign({ slug: "midday", hour: 13, minute: 21 })];
    expect(campaignSlotOptions(withAfternoon, "").map((option) => option.value)).toEqual([
      "morning",
      "afternoon",
      "evening",
    ]);
  });

  it("leaves out a bucket no campaign is in", () => {
    expect(campaignSlotOptions(campaigns, "").map((option) => option.value)).toEqual([
      "morning",
      "evening",
    ]);
  });

  it("offers a slot bucket only when a campaign is in it", () => {
    const unscheduled = [campaign({ slug: "odd", hour: null, minute: null })];
    expect(campaignSlotOptions(unscheduled, "").map((option) => option.value)).toEqual([
      "unscheduled",
    ]);
  });

  it("offers only the selection when there are no rows at all", () => {
    expect(campaignLineOptions([], "")).toEqual([]);
  });
});
