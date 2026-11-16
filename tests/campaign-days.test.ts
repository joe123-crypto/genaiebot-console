import { describe, expect, it } from "vitest";
import { ALL_WEEKDAYS, campaignDaysProblem, isEveryDay, weekdayTokens } from "@/src/domains/campaign-days";

describe("weekdayTokens", () => {
  it("spells the days the way the bot stores them, in week order", () => {
    expect(weekdayTokens([4, 0, 2])).toEqual(["Mon", "Wed", "Fri"]);
    expect(weekdayTokens(ALL_WEEKDAYS)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("isEveryDay", () => {
  it("is true only for the whole week, which is the absence of a restriction", () => {
    expect(isEveryDay(ALL_WEEKDAYS)).toBe(true);
    expect(isEveryDay([6, 5, 4, 3, 2, 1, 0])).toBe(true);
    expect(isEveryDay([0, 1, 2, 3, 4, 5])).toBe(false);
  });
});

describe("campaignDaysProblem", () => {
  const slugs = ["fruit-trees", "web-design"];

  it("accepts no days at all, and days for the selected campaigns", () => {
    expect(campaignDaysProblem(undefined, slugs)).toBeUndefined();
    expect(campaignDaysProblem({}, slugs)).toBeUndefined();
    expect(campaignDaysProblem({ "fruit-trees": [1, 3] }, slugs)).toBeUndefined();
    expect(campaignDaysProblem({ "fruit-trees": ALL_WEEKDAYS, "web-design": [0] }, slugs)).toBeUndefined();
  });

  it("refuses days for an unselected campaign", () => {
    expect(campaignDaysProblem({ borehole: [1] }, slugs)).toMatch(/not selected/);
  });

  it("refuses anything that is not a nonempty set of weekdays", () => {
    for (const days of [[], [7], [-1], [1.5], [1, 1], [0, 1, 2, 3, 4, 5, 6, 0], "mon", null]) {
      expect(campaignDaysProblem({ "fruit-trees": days }, slugs)).toMatch(/at least one day/);
    }
    expect(campaignDaysProblem("every day", slugs)).toMatch(/could not be read/);
    expect(campaignDaysProblem([["fruit-trees", [1]]], slugs)).toMatch(/could not be read/);
  });
});
