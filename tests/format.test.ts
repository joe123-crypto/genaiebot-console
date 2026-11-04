import { describe, expect, it } from "vitest";
import {
  campaignTitle,
  plural,
  shortJid,
  slotLabel,
  worstCaseRunSeconds,
} from "@/src/lib/format";

describe("campaignTitle", () => {
  it("title-cases a hyphenated slug", () => {
    expect(campaignTitle("borehole-drilling")).toBe("Borehole Drilling");
  });

  it("keeps acronym slugs upper case", () => {
    expect(campaignTitle("cv")).toBe("CV");
  });
});

describe("slotLabel", () => {
  it("zero-pads both halves", () => {
    expect(slotLabel({ hour: 7, minute: 5 })).toBe("07:05");
  });

  it("renders a placeholder when the cron had no parsable time", () => {
    expect(slotLabel({ hour: null, minute: null })).toBe("--:--");
  });
});

describe("worstCaseRunSeconds", () => {
  it("is zero for a campaign with no groups", () => {
    expect(worstCaseRunSeconds(0)).toBe(0);
  });

  // The engine waits up to 900s before the first send, then spaces sends by up
  // to 60s, and each send is budgeted 12s of wall clock. This mirrors the
  // invariant asserted in genaebot's deploy/test_promo_send_spacing.py.
  it("charges jitter once and a gap between each pair of sends", () => {
    expect(worstCaseRunSeconds(1)).toBe(900 + 0 + 12);
    expect(worstCaseRunSeconds(3)).toBe(900 + 120 + 36);
  });

  it("stays inside the 7200s cron timeout at today's largest campaign", () => {
    expect(worstCaseRunSeconds(46)).toBeLessThan(7200);
  });
});

describe("shortJid", () => {
  it("drops the group suffix", () => {
    expect(shortJid("120363422964450745@g.us")).toBe("120363422964450745");
  });
});

describe("plural", () => {
  it("keeps the singular at one", () => {
    expect(plural(1, "group")).toBe("1 group");
    expect(plural(2, "group")).toBe("2 groups");
  });
});
