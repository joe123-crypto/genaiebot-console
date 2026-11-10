import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ live: vi.fn(), legacy: vi.fn(), redirect: vi.fn() }));
vi.mock("@/src/lib/live-client", () => ({ getLiveView: mocks.live }));
vi.mock("@/src/lib/bot-client", () => ({ BotUnavailableError: class extends Error { constructor(public detail: string) { super(detail); } }, getGroups: mocks.legacy, getOverview: mocks.legacy }));
vi.mock("@/app/_components/shell-wrapper", () => ({ Shell: () => null }));
vi.mock("@/app/groups/_components/live-groups", () => ({ LiveGroups: () => null }));
vi.mock("@/app/campaigns/_components/live-campaigns", () => ({ LiveCampaigns: () => null }));
vi.mock("@/app/schedule/_components/live-schedule", () => ({ LiveScheduleView: () => null }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import GroupsPage from "@/app/groups/page";
import CampaignsPage from "@/app/campaigns/page";
import HomePage from "@/app/page";
import SchedulePage from "@/app/schedule/page";
import { BotUnavailableError } from "@/src/lib/bot-client";

beforeEach(() => { vi.resetAllMocks(); mocks.live.mockResolvedValue({ rows: [], total: 0, nextCursor: null, sync: { stale: false }, revision: "v1" }); });
describe("indexed page budgets", () => {
  it("loads only one indexed group page and forwards search and filters", async () => {
    await GroupsPage({ searchParams: Promise.resolve({ q: "Market", status: "active", line: "ads" }) });
    expect(mocks.live).toHaveBeenCalledOnce();
    const [view, query] = mocks.live.mock.calls[0];
    expect(view).toBe("groups"); expect(query.get("q")).toBe("Market"); expect(query.get("line")).toBe("ads");
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("loads compact indexed campaigns without a separate overview/capability read", async () => {
    await CampaignsPage({ searchParams: Promise.resolve({}) });
    expect(mocks.live).toHaveBeenCalledExactlyOnceWith("campaigns", new URLSearchParams());
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("keeps an unavailable index recoverable without falling back to a full collection", async () => {
    mocks.live.mockRejectedValue(new BotUnavailableError("Syncing"));
    const page = await GroupsPage({ searchParams: Promise.resolve({}) });
    expect(page.props.live).toBe(true); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("loads only schedule data at home and redirects the old schedule route", async () => {
    await HomePage(); expect(mocks.live).toHaveBeenCalledExactlyOnceWith("schedule");
    SchedulePage(); expect(mocks.redirect).toHaveBeenCalledWith("/");
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
});
