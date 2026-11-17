// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleCounts } from "@/app/schedule/_components/schedule-counts";

const mock = vi.hoisted(() => ({ live: vi.fn(), poll: vi.fn() }));
vi.mock("@/app/_components/use-live", () => ({ liveFetch: mock.live, useLivePoll: mock.poll }));

const lines = [{ id: "default", groupCount: 180 }, { id: "ads", groupCount: 132 }];
const accounts = [{ id: "default", connected: true }, { id: "ads", connected: true }, { id: "spare", connected: false }];
const reply = (value: unknown, ok = true) => Promise.resolve({ ok, json: async () => value } as Response);

function serve({ membership = true, gateway = true } = {}) {
  vi.stubGlobal("fetch", vi.fn((path: string) =>
    path === "/api/account-membership" ? reply({ lines }, membership) : reply({ observedAt: "now", accounts }, gateway)));
}
const value = (label: string) => screen.getByText(label).parentElement?.querySelector(".stat-value")?.textContent;

beforeEach(() => {
  mock.live.mockImplementation((view: string) => Promise.resolve(view === "campaign-clicks"
    ? { totalClicks: 120, todayClicks: 3, todayPartial: false } : { campaignTotal: 11 }));
  serve();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("the counts beside the overlap card", () => {
  it("totals groups across lines, counts campaigns and connected lines", async () => {
    render(<ScheduleCounts campaignsToday={10} />);
    await waitFor(() => expect(value("Groups")).toBe("312"));
    expect(screen.getByText("Across 2 lines")).toBeDefined();
    expect(value("Campaigns")).toBe("11");
    expect(screen.getByText("10 on today's timeline")).toBeDefined();
    expect(value("Lines connected")).toBe("2 of 3");
    expect(value("Total link clicks")).toBe("120");
    expect(screen.getByText("All time")).toBeDefined();
    expect(screen.getByText("3 today")).toBeDefined();
  });

  it("shows every source it did reach when one fails", async () => {
    mock.live.mockRejectedValue(new Error("Live updates unavailable."));
    serve({ gateway: false });
    render(<ScheduleCounts campaignsToday={10} />);
    await waitFor(() => expect(value("Groups")).toBe("312"));
    expect(value("Campaigns")).toBe("—");
    expect(value("Lines connected")).toBe("—");
    expect(screen.getByText("Status unavailable")).toBeDefined();
    expect(value("Total link clicks")).toBe("—");
    expect(screen.getByText("All time · unavailable")).toBeDefined();
  });

  it("holds a dash rather than a zero while nothing has been read", () => {
    mock.live.mockReturnValue(new Promise(() => {}));
    serve({ membership: false, gateway: false });
    render(<ScheduleCounts campaignsToday={10} />);
    expect(value("Groups")).toBe("—");
    expect(value("Lines connected")).toBe("—");
  });

  it("refreshes zero counts, labels the partial day, and retains the last successful result", async () => {
    let clicks: { totalClicks: number; todayClicks: number; todayPartial: boolean } | null = {
      totalClicks: 0, todayClicks: 0, todayPartial: true,
    };
    mock.live.mockImplementation((view: string) => {
      if (view !== "campaign-clicks") return Promise.resolve({ campaignTotal: 11 });
      return clicks ? Promise.resolve(clicks) : Promise.reject(new Error("Unavailable"));
    });
    render(<ScheduleCounts campaignsToday={10} />);
    await waitFor(() => expect(value("Total link clicks")).toBe("0"));
    expect(screen.getByText("0 today (since update)")).toBeDefined();

    const refresh = () => act(async () => { await mock.poll.mock.lastCall?.[0](new AbortController().signal); });
    clicks = { totalClicks: 5, todayClicks: 2, todayPartial: false };
    await refresh();
    expect(value("Total link clicks")).toBe("5");
    expect(screen.getByText("2 today")).toBeDefined();

    clicks = null;
    await refresh();
    expect(value("Total link clicks")).toBe("5");
    expect(screen.getByText("Last daily count · 2")).toBeDefined();
    expect(screen.getByText("All time · last available")).toBeDefined();
  });
});
