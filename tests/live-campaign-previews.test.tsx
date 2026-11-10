// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/app/campaigns/actions", () => ({ setCampaignEnabledAction: vi.fn(), deleteCampaignAction: vi.fn() }));
import { LiveCampaigns } from "@/app/campaigns/_components/live-campaigns";
import { CampaignsTable } from "@/app/campaigns/_components/campaigns-table";
import { DEFAULT_CAMPAIGN_FILTER } from "@/src/domains/campaign-filter";
import { campaign } from "./fixtures/campaign-detail";
import type { CampaignRow, LivePage } from "@/src/lib/live-types";

const { captions, images, assets, script, ...summary } = campaign;
const row: CampaignRow = { ...summary, captionCount: 3, imageCount: 4, thumbnailUrl: assets![0].url };
const sync = { revision: "1", state: "live" as const, stale: false, syncedAt: "2026-11-10T10:00:00Z" };
const initial: LivePage<CampaignRow> = { rows: [row], revision: "1", sync, total: 2, nextCursor: "next" };
function mount(rows: CampaignRow[] = [row]) {
  return render(<LiveCampaigns initial={{ ...initial, rows }} filter={DEFAULT_CAMPAIGN_FILTER} writable={false} />);
}
function sources(container: HTMLElement) { return Array.from(container.querySelectorAll("img"), img => img.getAttribute("src")); }
beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/campaigns");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("campaign list previews", () => {
  it("renders compact preview metadata without fetching campaign details", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const view = mount();
    expect(sources(view.container)).toEqual([row.thumbnailUrl]);
    expect(screen.getByText("4 images")).toBeTruthy();
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("3 variants")).toBeTruthy();
    expect(view.container.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("distinguishes no images, unavailable URLs, and an older bot's missing metadata", () => {
    const { imageCount, thumbnailUrl, ...older } = row;
    const view = mount([
      { ...row, slug: "empty", imageCount: 0, thumbnailUrl: null },
      { ...row, slug: "no-url", imageCount: 2, thumbnailUrl: null },
      { ...older, slug: "older" },
    ]);
    expect(sources(view.container)).toEqual([]);
    expect(screen.getByText("0 images")).toBeTruthy();
    expect(screen.getByText("2 images")).toBeTruthy();
    expect(screen.getByText("Images unavailable")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("keeps full campaign callers displaying their original pictures", () => {
    const view = render(<CampaignsTable campaigns={[campaign]} initialFilter={DEFAULT_CAMPAIGN_FILTER} />);
    expect(sources(view.container)).toEqual([assets![0].url]);
    expect(screen.getByText("1 image")).toBeTruthy();
  });

  it("preserves previews through pagination and unchanged polls, then accepts a new URL", async () => {
    const next = { ...row, slug: "fruit-trees", imageCount: 1, thumbnailUrl: "https://ads.example.test/next.jpg" };
    const updated = { ...row, thumbnailUrl: "https://ads.example.test/replacement.jpg" };
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...initial, rows: [next], nextCursor: null }))
      .mockResolvedValueOnce(Response.json({ revision: "1", unchanged: true, sync }))
      .mockResolvedValueOnce(Response.json({ ...initial, rows: [updated, next], revision: "2", nextCursor: null }));
    vi.stubGlobal("fetch", fetch);
    const view = mount();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load more" })));
    expect(sources(view.container)).toEqual([row.thumbnailUrl, next.thumbnailUrl]);
    fireEvent.error(view.container.querySelector("img")!);
    expect(sources(view.container)).toEqual([next.thumbnailUrl]);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(sources(view.container)).toEqual([next.thumbnailUrl]);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(sources(view.container)).toEqual([updated.thumbnailUrl, next.thumbnailUrl]);
    expect(fetch.mock.calls).toHaveLength(3);
    expect(fetch.mock.calls.every(([url]) => String(url).startsWith("/api/live/campaigns?"))).toBe(true);
    expect(fetch.mock.calls[0][0]).toContain("cursor=next");
    expect(fetch.mock.calls[1][0]).toContain("since=1");
  });
});
