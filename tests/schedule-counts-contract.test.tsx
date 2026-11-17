// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleCounts } from "@/app/schedule/_components/schedule-counts";

/** Deliberately does NOT mock use-live. The sibling suite does, which is why the
 *  Home card once shipped asking the bot for a read it does not serve: the URL and
 *  the refusal behind it were never exercised. These go through the real liveFetch. */

const CLICKS = "/api/live/campaign-clicks?";
const totals = { totalClicks: 120, todayClicks: 3, todayPartial: false };
const lines = [{ id: "default", groupCount: 180 }];
const accounts = [{ id: "default", connected: true }];

/** Every source but the clicks read answers, so only the clicks card can move. */
function serve(clicks: Response) {
  const fetch = vi.fn((path: string) => {
    if (path.startsWith("/api/live/campaign-clicks")) return Promise.resolve(clicks.clone());
    if (path.startsWith("/api/live/navigation")) return Promise.resolve(Response.json({ campaignTotal: 11 }));
    if (path === "/api/account-membership") return Promise.resolve(Response.json({ lines }));
    return Promise.resolve(Response.json({ observedAt: "now", accounts }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the Home click totals against the live route", () => {
  it("asks for totals with no slug, and shows them", async () => {
    const fetch = serve(Response.json(totals));
    render(<ScheduleCounts campaignsToday={10} />);

    await waitFor(() => expect(screen.getByText("120")).toBeTruthy());
    expect(screen.getByText("All time")).toBeTruthy();
    expect(screen.getByText("3 today")).toBeTruthy();
    // A slug here would make this the per-campaign report, which has no daily count.
    expect(fetch).toHaveBeenCalledWith(CLICKS, expect.objectContaining({ cache: "no-store" }));
  });

  it("names the missing bot update when the bot refuses the slugless read", async () => {
    serve(Response.json({ error: "Campaign click counts require one valid slug." }, { status: 400 }));
    render(<ScheduleCounts campaignsToday={10} />);

    await waitFor(() => expect(screen.getByText("All time · needs the bot update")).toBeTruthy());
    expect(screen.getByText("Deploy the companion bot update for click totals.")).toBeTruthy();
    expect(screen.queryByText("All time · unavailable")).toBeNull();
  });

  it("calls a synchronizing bot unavailable rather than out of date", async () => {
    serve(Response.json({ error: "Campaign click counts are unavailable." }, { status: 503 }));
    render(<ScheduleCounts campaignsToday={10} />);

    await waitFor(() => expect(screen.getByText("All time · unavailable")).toBeTruthy());
    expect(screen.getByText("— today")).toBeTruthy();
    expect(screen.queryByText("Deploy the companion bot update for click totals.")).toBeNull();
  });
});
