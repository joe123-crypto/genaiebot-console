// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignsTable } from "@/app/campaigns/_components/campaigns-table";
import { DEFAULT_CAMPAIGN_FILTER } from "@/src/domains/campaign-filter";
import type { Campaign } from "@/src/lib/types";

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
  tracking: { prefix: "BH" },
  accounts: { default: 33, ads: 11 },
  weeklyCount: 1,
});
const lighting = campaign({ slug: "industrial-lighting", hour: 13, accounts: { ads: 13 } });
const cv = campaign({ slug: "cv", hour: 11, enabled: false });
const campaigns = [borehole, lighting, cv];

const props = { campaigns, initialFilter: DEFAULT_CAMPAIGN_FILTER };

function mount(overrides: Partial<typeof props> = {}) {
  return render(createElement(CampaignsTable, { ...props, ...overrides }));
}

/** Body rows only — the header row is in its own section. */
function rows() {
  const [body] = screen.getAllByRole("rowgroup").slice(1);
  return within(body).queryAllByRole("row");
}
function titles() {
  return rows()
    .map((row) => row.querySelector(".cell-strong a")?.textContent ?? "")
    .filter(Boolean);
}
const searchBox = () => screen.getByRole("searchbox");
const count = () => screen.getByRole("status").textContent;

function pick(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function type(value: string) {
  fireEvent.change(searchBox(), { target: { value } });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/campaigns");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("rendering", () => {
  it("lists every campaign in the order it was given", () => {
    mount();
    expect(titles()).toEqual(["Borehole Drilling", "Industrial Lighting", "CV"]);
    expect(count()).toBe("Showing all 3 campaigns");
  });

  it("keeps each row linking to its preview", () => {
    mount();
    const link = screen.getByRole("link", { name: "Preview Borehole Drilling" });
    expect(link.getAttribute("href")).toBe("/campaigns/borehole-drilling");
  });

  it("still marks a switched-off campaign", () => {
    mount();
    expect(screen.getByText("switched off")).toBeTruthy();
  });

  it("renders already filtered when the server parsed a filter from the URL", () => {
    mount({ initialFilter: { ...DEFAULT_CAMPAIGN_FILTER, status: "off" } });
    expect(titles()).toEqual(["CV"]);
  });
});

describe("searching", () => {
  it("narrows as the key goes down", () => {
    mount();
    type("borehole");
    expect(titles()).toEqual(["Borehole Drilling"]);
    expect(count()).toBe("Showing 1 of 3 campaigns");
  });

  it("finds a campaign by its ref prefix", () => {
    mount();
    type("BH");
    expect(titles()).toEqual(["Borehole Drilling"]);
  });

  it("finds a campaign by the id under its name", () => {
    mount();
    type("industrial-lighting-promo");
    expect(titles()).toEqual(["Industrial Lighting"]);
  });

  it("says so when nothing matches", () => {
    mount();
    type("nothing here");
    expect(titles()).toEqual([]);
    const empty = screen.getByText("No campaign matches these filters.");
    expect(empty.closest("td")?.getAttribute("colspan")).toBe("6");
  });
});

describe("facets", () => {
  it("narrows by status, line, cadence and slot", () => {
    mount();
    pick("Status", "off");
    expect(titles()).toEqual(["CV"]);

    pick("Status", "running");
    expect(titles()).toEqual(["Borehole Drilling", "Industrial Lighting"]);

    pick("Status", "all");
    pick("Line", "ads");
    expect(titles()).toEqual(["Borehole Drilling", "Industrial Lighting"]);

    pick("Line", "");
    pick("Cadence", "weekly");
    expect(titles()).toEqual(["Borehole Drilling"]);

    pick("Cadence", "");
    pick("Slot", "afternoon");
    expect(titles()).toEqual(["Industrial Lighting"]);
  });

  it("matches a line a campaign shares with another", () => {
    mount();
    pick("Line", "default");
    expect(titles()).toEqual(["Borehole Drilling", "CV"]);
  });

  it("keeps a selected line whose campaigns have gone, and says the filter is empty", () => {
    mount({ initialFilter: { ...DEFAULT_CAMPAIGN_FILTER, line: "retired" } });
    const select = screen.getByLabelText("Line") as HTMLSelectElement;
    expect(select.value).toBe("retired");
    expect(within(select).getByText("retired (no campaigns)")).toBeTruthy();
    expect(screen.getByText("No campaign matches these filters.")).toBeTruthy();
  });
});

describe("clearing", () => {
  it("is off until something is filtered, then restores every row", () => {
    mount();
    const clear = () => screen.getByRole("button", { name: "Clear filters" }) as HTMLButtonElement;
    expect(clear().disabled).toBe(true);

    type("borehole");
    pick("Line", "ads");
    expect(clear().disabled).toBe(false);

    fireEvent.click(clear());
    expect(titles()).toHaveLength(3);
    expect((searchBox() as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Line") as HTMLSelectElement).value).toBe("");
  });

  it("hands focus back to the search box, which the disabled button cannot keep", () => {
    mount();
    type("borehole");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(document.activeElement).toBe(searchBox());
  });
});

describe("the URL", () => {
  function settle() {
    act(() => {
      vi.advanceTimersByTime(300);
    });
  }

  it("carries the filter once typing pauses", () => {
    vi.useFakeTimers();
    mount();
    type("borehole");
    pick("Slot", "morning");
    settle();
    expect(window.location.pathname + window.location.search).toBe(
      "/campaigns?q=borehole&slot=morning",
    );
  });

  it("goes back to a clean path when the filter is cleared", () => {
    vi.useFakeTimers();
    mount();
    pick("Status", "off");
    settle();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    settle();
    expect(window.location.search).toBe("");
  });

  it("leaves a parameter it knows nothing about alone", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/campaigns?date=2026-11-08");
    mount();
    type("borehole");
    settle();
    expect(window.location.search).toContain("date=2026-11-08");
    expect(window.location.search).toContain("q=borehole");
  });
});

describe("the 60s refresh", () => {
  it("leaves the filter, the typed query and the focus alone", () => {
    // The refresh re-renders from the same url, so the filter comes back equal.
    const view = mount();
    type("borehole");
    pick("Line", "ads");
    searchBox().focus();

    view.rerender(
      createElement(CampaignsTable, {
        campaigns: [...campaigns, campaign({ slug: "brand-new" })],
        initialFilter: { ...DEFAULT_CAMPAIGN_FILTER },
      }),
    );

    expect((searchBox() as HTMLInputElement).value).toBe("borehole");
    expect((screen.getByLabelText("Line") as HTMLSelectElement).value).toBe("ads");
    expect(document.activeElement).toBe(searchBox());
    expect(titles()).toEqual(["Borehole Drilling"]);
  });

  it("does not snap back a search typed since the url was last written", () => {
    vi.useFakeTimers();
    const view = mount();
    type("borehole");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    type("borehole drilling");

    view.rerender(
      createElement(CampaignsTable, {
        ...props,
        initialFilter: { ...DEFAULT_CAMPAIGN_FILTER, q: "borehole" },
      }),
    );

    expect((searchBox() as HTMLInputElement).value).toBe("borehole drilling");
  });
});

describe("a link followed while already on the page", () => {
  it("applies the filter it asked for", () => {
    const view = mount();
    expect(titles()).toHaveLength(3);

    view.rerender(
      createElement(CampaignsTable, {
        ...props,
        initialFilter: { ...DEFAULT_CAMPAIGN_FILTER, status: "off" },
      }),
    );

    expect(titles()).toEqual(["CV"]);
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("off");
  });

  it("brings new rows in under the filter already set", () => {
    const view = mount();
    pick("Line", "ads");
    expect(titles()).toEqual(["Borehole Drilling", "Industrial Lighting"]);

    view.rerender(
      createElement(CampaignsTable, {
        ...props,
        campaigns: [...campaigns, campaign({ slug: "fresh-ads", accounts: { ads: 4 } })],
      }),
    );
    expect(titles()).toEqual(["Borehole Drilling", "Industrial Lighting", "Fresh Ads"]);
    expect(count()).toBe("Showing 3 of 4 campaigns");
  });
});
