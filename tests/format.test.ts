import { describe, expect, it } from "vitest";
import {
  campaignTitle,
  clockLabel,
  confirmLabel,
  minutesOfDay,
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

describe("confirmLabel", () => {
  it("asks for the name when there is one", () => {
    expect(confirmLabel({ name: "BULAWAYO ADVERTS", jid: "120363@g.us" })).toBe(
      "BULAWAYO ADVERTS",
    );
  });

  it("falls back to the jid, not to a shared placeholder", () => {
    // Most rows the operator wants to delete are unnamed, and `groupLabel`
    // calls all of them "Unnamed group" -- typing that would confirm nothing.
    expect(confirmLabel({ name: null, jid: "120363427619606842@g.us" })).toBe(
      "120363427619606842",
    );
  });

  it("treats a blank name as no name, so the box cannot be satisfied empty", () => {
    expect(confirmLabel({ name: "   ", jid: "120363@g.us" })).toBe("120363");
  });
});

describe("minutesOfDay", () => {
  // Harare is UTC+2 all year, so 05:15Z is the 07:15 slot's own start minute.
  it("reads the clock in the bot's timezone, not the machine's", () => {
    expect(minutesOfDay(new Date("2026-11-06T05:15:00Z"))).toBe(7 * 60 + 15);
  });

  it("counts from Harare midnight, not from UTC midnight", () => {
    expect(minutesOfDay(new Date("2026-11-06T22:00:00Z"))).toBe(0);
    expect(minutesOfDay(new Date("2026-11-06T21:59:00Z"))).toBe(23 * 60 + 59);
  });

  it("honours a timezone that is not the default", () => {
    expect(minutesOfDay(new Date("2026-11-06T05:15:00Z"), "UTC")).toBe(5 * 60 + 15);
  });
});

describe("clockLabel", () => {
  it("prints minutes since midnight the way a slot prints", () => {
    expect(clockLabel(905)).toBe("15:05");
    expect(clockLabel(0)).toBe("00:00");
  });

  it("rounds a fractional finish to the minute", () => {
    expect(clockLabel(65.6)).toBe("01:06");
  });
});
