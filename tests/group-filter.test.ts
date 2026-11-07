import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_FILTER,
  campaignOptions,
  filterGroups,
  groupFilterQuery,
  groupHaystack,
  isAdvertising,
  isDefaultGroupFilter,
  isIdle,
  lineOptions,
  matchesGroupQuery,
  needsDecision,
  parseGroupFilter,
  sortGroupsForTable,
  tierOptions,
  type GroupFilter,
} from "@/src/domains/group-filter";
import type { Group } from "@/src/lib/types";

function group(overrides: Partial<Group> & Pick<Group, "jid">): Group {
  return {
    name: null,
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
    ...overrides,
  };
}

const market = group({ jid: "120363111@g.us", name: "Harare Market", promos: ["borehole"] });
const nameless = group({ jid: "120363222@g.us", account: "ads", activity: "busy" });
const blankName = group({ jid: "120363333@g.us", name: "   ", status: "on-hold" });
const left = group({ jid: "120363444@g.us", name: "Gone", status: "not-a-member" });
const quiet = group({ jid: "120363555@g.us", name: "Quiet Corner", account: "ads", activity: "quiet", promos: ["cv", "retired"] });
const groups = [market, nameless, blankName, left, quiet];

function filter(overrides: Partial<GroupFilter> = {}): GroupFilter {
  return { ...DEFAULT_GROUP_FILTER, ...overrides };
}
const jids = (rows: Group[]) => rows.map((row) => row.jid);

describe("the three bands", () => {
  it("are disjoint and exhaustive", () => {
    // The regression `needsDecision` exists to stop: one flat table can only
    // replace the three cards if every row lands in exactly one band.
    for (const row of groups) {
      const bands = [needsDecision(row), isAdvertising(row), isIdle(row)].filter(Boolean);
      expect(bands).toHaveLength(1);
    }
  });

  it("reproduce the partitions the three cards computed", () => {
    expect(jids(groups.filter(needsDecision))).toEqual([blankName.jid, left.jid]);
    expect(jids(groups.filter(isAdvertising))).toEqual([market.jid, quiet.jid]);
    expect(jids(groups.filter(isIdle))).toEqual([nameless.jid]);
  });
});

describe("parseGroupFilter", () => {
  it("defaults an empty query string", () => {
    expect(parseGroupFilter({})).toEqual(DEFAULT_GROUP_FILTER);
  });

  it("reads a URLSearchParams as well as a searchParams object", () => {
    const expected = filter({ q: "market", status: "advertising" });
    expect(parseGroupFilter({ q: "market", status: "advertising" })).toEqual(expected);
    expect(parseGroupFilter(new URLSearchParams("q=market&status=advertising"))).toEqual(expected);
  });

  it("falls back to every group when status is junk", () => {
    expect(parseGroupFilter({ status: "../../etc" }).status).toBe("all");
    expect(parseGroupFilter({ status: "" }).status).toBe("all");
  });

  it("accepts both a view and a raw status", () => {
    expect(parseGroupFilter({ status: "needs-decision" }).status).toBe("needs-decision");
    expect(parseGroupFilter({ status: "admin-only" }).status).toBe("admin-only");
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseGroupFilter({ status: ["active", "on-hold"], q: ["one", "two"] })).toEqual(
      filter({ status: "active", q: "one" }),
    );
  });

  it("keeps a line, campaign or tier that matches no group", () => {
    // Deliberate: the filter is parsed before the rows are known, and a shared
    // link must survive a value whose groups have since gone.
    expect(parseGroupFilter({ line: "retired-line", campaign: "gone", tier: "frantic" })).toEqual(
      filter({ line: "retired-line", campaign: "gone", tier: "frantic" }),
    );
  });

  it.each([
    filter(),
    filter({ q: "harare market" }),
    filter({ status: "not-a-member" }),
    filter({ line: "ads", campaign: "cv", tier: "quiet" }),
    filter({ q: "a b", status: "advertising", line: "default", campaign: "borehole", tier: "busy" }),
  ])("round-trips through the query string", (original) => {
    expect(parseGroupFilter(groupFilterQuery(original))).toEqual(original);
  });
});

describe("groupFilterQuery", () => {
  it("writes nothing for an unfiltered table", () => {
    expect(groupFilterQuery(DEFAULT_GROUP_FILTER).toString()).toBe("");
    expect(isDefaultGroupFilter(DEFAULT_GROUP_FILTER)).toBe(true);
  });

  it("writes only the keys that were set", () => {
    expect(groupFilterQuery(filter({ line: "ads" })).toString()).toBe("line=ads");
  });

  it.each(["q", "status", "line", "campaign", "tier"] as const)(
    "stops being default once %s is set",
    (key) => {
      expect(isDefaultGroupFilter(filter({ [key]: key === "status" ? "advertising" : "x" }))).toBe(false);
    },
  );
});

describe("searching", () => {
  it("matches a name whatever the case", () => {
    expect(matchesGroupQuery(market, "HARARE")).toBe(true);
    expect(matchesGroupQuery(market, "market")).toBe(true);
  });

  it("matches the bare id and the whole jid", () => {
    expect(matchesGroupQuery(market, "120363111")).toBe(true);
    expect(matchesGroupQuery(market, "120363111@g.us")).toBe(true);
  });

  it("finds a nameless group by the label it shows", () => {
    expect(matchesGroupQuery(nameless, "unnamed")).toBe(true);
    expect(matchesGroupQuery(blankName, "unnamed")).toBe(true);
    expect(groupHaystack(blankName)).toContain("unnamed group");
  });

  it("matches everything on a blank or whitespace query", () => {
    expect(matchesGroupQuery(market, "")).toBe(true);
    expect(matchesGroupQuery(market, "   ")).toBe(true);
  });

  it("treats the query as text, not a pattern", () => {
    expect(matchesGroupQuery(market, "120363111.g.us")).toBe(false);
    expect(matchesGroupQuery(market, ".*")).toBe(false);
  });
});

describe("filterGroups", () => {
  it("narrows by each facet on its own", () => {
    expect(jids(filterGroups(groups, filter({ line: "ads" })))).toEqual([nameless.jid, quiet.jid]);
    expect(jids(filterGroups(groups, filter({ tier: "quiet" })))).toEqual([quiet.jid]);
    expect(jids(filterGroups(groups, filter({ campaign: "borehole" })))).toEqual([market.jid]);
    expect(jids(filterGroups(groups, filter({ status: "on-hold" })))).toEqual([blankName.jid]);
    expect(jids(filterGroups(groups, filter({ status: "needs-decision" })))).toEqual([
      blankName.jid,
      left.jid,
    ]);
  });

  it("ands the facets together", () => {
    expect(jids(filterGroups(groups, filter({ line: "ads", tier: "busy" })))).toEqual([nameless.jid]);
    expect(filterGroups(groups, filter({ line: "ads", campaign: "borehole" }))).toEqual([]);
  });

  it("ands the search with the facets", () => {
    expect(jids(filterGroups(groups, filter({ q: "quiet", line: "ads" })))).toEqual([quiet.jid]);
    expect(filterGroups(groups, filter({ q: "quiet", line: "default" }))).toEqual([]);
  });

  it("returns everything when nothing is set", () => {
    expect(filterGroups(groups, DEFAULT_GROUP_FILTER)).toHaveLength(groups.length);
  });
});

describe("sortGroupsForTable", () => {
  it("puts the rows needing a decision first, then advertising, then idle", () => {
    expect(jids(sortGroupsForTable(groups))).toEqual([
      blankName.jid,
      left.jid,
      market.jid,
      quiet.jid,
      nameless.jid,
    ]);
  });

  it("keeps the order the bot sent within a band", () => {
    const first = group({ jid: "a@g.us", promos: ["borehole"] });
    const second = group({ jid: "b@g.us", promos: ["borehole"] });
    expect(jids(sortGroupsForTable([second, first]))).toEqual(["b@g.us", "a@g.us"]);
  });

  it("does not mutate its argument", () => {
    const order = jids(groups);
    sortGroupsForTable(groups);
    expect(jids(groups)).toEqual(order);
  });
});

describe("facet options", () => {
  it("lists each line once, in a stable order", () => {
    expect(lineOptions(groups, "")).toEqual([
      { value: "ads", label: "ads" },
      { value: "default", label: "default" },
    ]);
  });

  it("always offers the three known tiers, plus any the bot has invented", () => {
    const exotic = [group({ jid: "x@g.us", activity: "frantic" as never })];
    expect(tierOptions(exotic, "").map((option) => option.value)).toEqual([
      "busy",
      "frantic",
      "normal",
      "quiet",
    ]);
  });

  it("lists a switched-off campaign and says so", () => {
    expect(campaignOptions(groups, ["retired"], "")).toEqual([
      { value: "borehole", label: "Borehole" },
      { value: "cv", label: "CV" },
      { value: "retired", label: "Retired (off)" },
    ]);
  });

  it("keeps a selection whose groups are gone, flagged", () => {
    // Otherwise the select would show its first option while the table went on
    // filtering by something else.
    expect(lineOptions(groups, "retired-line")).toContainEqual({
      value: "retired-line",
      label: "retired-line (no groups)",
      stale: true,
    });
    expect(campaignOptions(groups, [], "gone")).toContainEqual({
      value: "gone",
      label: "Gone (no groups)",
      stale: true,
    });
    expect(tierOptions(groups, "frantic")).toContainEqual({
      value: "frantic",
      label: "frantic (no groups)",
      stale: true,
    });
  });

  it("offers only the selection when there are no rows at all", () => {
    expect(lineOptions([], "")).toEqual([]);
    expect(campaignOptions([], [], "")).toEqual([]);
  });
});
