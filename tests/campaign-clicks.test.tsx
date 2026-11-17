// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignClicks } from "@/app/campaigns/_components/campaign-clicks";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("campaign click counts", () => {
  it("shows the campaign total and per-group counts", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      totalClicks: 5,
      groups: [
        { jid: "1@g.us", name: "Market", clicks: 4 },
        { jid: "2@g.us", name: "Town", clicks: 1 },
      ],
    }));
    vi.stubGlobal("fetch", fetch);
    const view = render(<CampaignClicks slug="appliance-repairs" />);

    const panel = screen.getByRole("region", { name: "Estimated link clicks" });
    const summary = await within(panel).findByText(/Clicks by group/);
    expect(within(panel).getByText("5")).toBeTruthy();
    // The breakdown stays out of the way until it is asked for.
    const disclosure = view.container.querySelector("details")!;
    expect(disclosure.open).toBe(false);
    expect(summary.textContent).toContain("2 groups");

    fireEvent.click(summary.closest("summary")!);
    expect(disclosure.open).toBe(true);
    const table = within(panel).getByRole("table", { name: "Link clicks by group" });
    expect(within(table).getByRole("row", { name: "Market 4" })).toBeTruthy();
    expect(within(table).getByRole("row", { name: "Town 1" })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/live/campaign-clicks?slug=appliance-repairs",
      expect.objectContaining({ cache: "no-store" }));
  });

  it("distinguishes unavailable counts from a successful zero after retry", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ totalClicks: 0, groups: [] })));
    render(<CampaignClicks slug="appliance-repairs" />);

    expect(await screen.findByText("Click counts are unavailable.")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry click counts" }));
    expect(await screen.findByText("0")).toBeTruthy();
    expect(screen.queryByText("Click counts are unavailable.")).toBeNull();
  });
});
