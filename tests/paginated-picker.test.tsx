// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaginatedPicker } from "@/app/_components/paginated-picker";
import type { LiveFacets } from "@/src/lib/live-types";

const campaigns: LiveFacets["campaigns"] = [
  { slug: "daily", name: "Daily", enabled: true },
  { slug: "weekly", name: "Weekly", enabled: true },
  { slug: "switched-off", name: "Switched off", enabled: false },
];

function group(jid: string, name: string, promos: string[], pausedPromos?: string[]) {
  return { jid, name, account: "ads", status: "active", promos, pausedPromos, allowedToday: [] };
}

function page(rows: ReturnType<typeof group>[], options: { nextCursor?: string; campaignMetadata?: boolean } = {}) {
  return Response.json({
    rows,
    revision: "1",
    sync: { stale: false, revision: "1", state: "live", syncedAt: null },
    nextCursor: options.nextCursor ?? null,
    facets: options.campaignMetadata === false ? undefined : { campaigns, lines: ["ads"], tiers: [] },
    disabledPromos: ["weekly", "switched-off"],
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("campaign counts in the group picker", () => {
  it("counts distinct enabled, unpaused assignments across pages and search results", async () => {
    const fetch = vi.fn(async (url: string) => {
      const params = new URL(url, "https://console.example").searchParams;
      if (params.get("q")) return page([group("5@g.us", "Search match", ["weekly"])]);
      if (params.get("cursor")) return page([group("4@g.us", "More groups", ["daily", "weekly"])]);
      return page([
        group("1@g.us", "Busy group", ["daily", "daily", "weekly", "switched-off", "unknown"]),
        group("2@g.us", "Other group", ["daily", "weekly"], ["daily"]),
        group("3@g.us", "Quiet group", ["switched-off"]),
      ], { nextCursor: "next" });
    });
    vi.stubGlobal("fetch", fetch);
    render(<PaginatedPicker kind="groups" close={vi.fn()} choose={vi.fn()} />);

    await screen.findByRole("checkbox", { name: /^Busy group · ads\s*2 active campaigns$/ });
    screen.getByRole("checkbox", { name: /^Other group · ads\s*1 active campaign$/ });
    screen.getByRole("checkbox", { name: /^Quiet group · ads\s*0 active campaigns$/ });
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByRole("checkbox", { name: /^More groups · ads\s*2 active campaigns$/ });
    expect(fetch.mock.calls[1][0]).toContain("cursor=next");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search groups" }), { target: { value: "match" } });
    await screen.findByRole("checkbox", { name: /^Search match · ads\s*1 active campaign$/ });
    expect(screen.queryByRole("checkbox", { name: /Busy group/ })).toBeNull();
    expect(fetch.mock.calls[2][0]).toContain("q=match");
  });

  it("allows adding a group when campaign metadata is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page([
      group("1@g.us", "Market", ["daily"]),
    ], { campaignMetadata: false })));
    const choose = vi.fn();
    render(<PaginatedPicker kind="groups" close={vi.fn()} choose={choose} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /^Market · ads\s*Campaign count unavailable$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 selected" }));
    expect(choose).toHaveBeenCalledWith([{ id: "1@g.us", name: "Market", account: "ads", status: "active" }]);
  });
});

describe("posting days in the campaign picker", () => {
  const schedule = { gate: { allowed: true } as const };
  const campaignPage = Response.json({
    rows: [{ slug: "fruit-trees", name: "Fruit Trees" }, { slug: "web-design", name: "Web Design" }],
    revision: "1", sync: { stale: false, revision: "1", state: "live", syncedAt: null }, nextCursor: null,
  });

  function openPicker(props: Partial<Parameters<typeof PaginatedPicker>[0]> = {}) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(campaignPage.clone()));
    const choose = vi.fn();
    render(<PaginatedPicker kind="campaigns" close={vi.fn()} choose={choose} {...props} />);
    return choose;
  }

  it("offers days only for a ticked campaign, and sends them per campaign", async () => {
    const choose = openPicker({ schedule });
    const fruit = await screen.findByRole("checkbox", { name: /Fruit Trees/ });
    expect(screen.queryByRole("checkbox", { name: "Only on certain days" })).toBeNull();

    fireEvent.click(fruit);
    fireEvent.click(screen.getByRole("checkbox", { name: "Only on certain days" }));
    // It opens on the whole week, which is no restriction at all.
    const days = screen.getByRole("group", { name: "Posting days for Fruit Trees" });
    expect(screen.getByText(/clears any day restriction/)).toBeTruthy();
    for (const day of ["Mon", "Wed", "Fri", "Sat", "Sun"]) {
      fireEvent.click(within(days).getByRole("checkbox", { name: day }));
    }

    fireEvent.click(screen.getByRole("checkbox", { name: /Web Design/ }));
    expect(screen.getAllByRole("checkbox", { name: "Only on certain days" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Add 2 selected" }));
    expect(choose).toHaveBeenCalledWith([
      { id: "fruit-trees", name: "Fruit Trees", weekdays: [1, 3] },
      { id: "web-design", name: "Web Design" },
    ]);
  });

  it("holds the add while a restricted campaign names no day, and forgets days when unticked", async () => {
    const choose = openPicker({ schedule });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Fruit Trees/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Only on certain days" }));
    const days = screen.getByRole("group", { name: "Posting days for Fruit Trees" });
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      fireEvent.click(within(days).getByRole("checkbox", { name: day }));
    }
    const add = screen.getByRole("button", { name: "Add 1 selected" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText(/Choose at least one day/)).toBeTruthy();
    fireEvent.click(add);
    expect(choose).not.toHaveBeenCalled();

    // Unticking the campaign drops its days; ticking it again starts over.
    fireEvent.click(screen.getByRole("checkbox", { name: /Fruit Trees/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Fruit Trees/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 selected" }));
    expect(choose).toHaveBeenCalledWith([{ id: "fruit-trees", name: "Fruit Trees" }]);
  });

  it("says why days are unavailable and still adds campaigns without them", async () => {
    const choose = openPicker({ schedule: { gate: { allowed: false, reason: "The bot does not accept changes to weekly yet." } } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Fruit Trees/ }));
    expect(screen.getByText("The bot does not accept changes to weekly yet.")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Only on certain days" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 selected" }));
    expect(choose).toHaveBeenCalledWith([{ id: "fruit-trees", name: "Fruit Trees" }]);
  });

  it("leaves a picker with no schedule offer alone", async () => {
    openPicker();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Fruit Trees/ }));
    expect(screen.queryByRole("checkbox", { name: "Only on certain days" })).toBeNull();
  });
});
