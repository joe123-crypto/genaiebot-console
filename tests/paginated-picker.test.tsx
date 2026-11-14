// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
