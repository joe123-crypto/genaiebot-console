// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/app/campaigns/actions", () => ({ setCampaignEnabledAction: vi.fn(), deleteCampaignAction: vi.fn() }));
import { LiveCampaigns } from "@/app/campaigns/_components/live-campaigns";
import { DEFAULT_CAMPAIGN_FILTER } from "@/src/domains/campaign-filter";
import { campaign } from "./fixtures/campaign-detail";
import type { CampaignRow, LivePage } from "@/src/lib/live-types";

const sync = { revision: "1", state: "live" as const, stale: false, syncedAt: "2026-11-10T10:00:00Z" };
const rows: CampaignRow[] = [0, 1, 2].map(index => ({ ...campaign, slug: `campaign-${index}`, name: `Campaign ${index}`, captionCount: 1, imageCount: 0 }));
const page = (overrides: Partial<LivePage<CampaignRow>> = {}): LivePage<CampaignRow> => ({ rows, revision: "1", sync, total: 5, nextCursor: "page-2", ...overrides });
const observers: { callback: IntersectionObserverCallback; options?: IntersectionObserverInit; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 600, width: 600, height: bottom - top, x: 0, y: top, toJSON() {} });
/** The phone layout, where the table is full height and the page scrolls. */
const matchPhone = () => vi.stubGlobal("matchMedia", (media: string) => ({
  media, matches: media === "(max-width: 760px)", addEventListener: vi.fn(), removeEventListener: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/campaigns");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", class {
    observe = vi.fn(); disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { observers.push({ callback, options, observe: this.observe, disconnect: this.disconnect }); }
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("observes the end of the inner table, while manual and automatic pagination append without duplicates", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(page({ rows: [rows[2], { ...rows[0], slug: "campaign-3", name: "Campaign 3" }], nextCursor: "page-3" })))
    .mockResolvedValueOnce(Response.json(page({ rows: [{ ...rows[0], slug: "campaign-4", name: "Campaign 4" }], nextCursor: null })));
  vi.stubGlobal("fetch", fetch);
  const { container } = render(<LiveCampaigns initial={page()} filter={DEFAULT_CAMPAIGN_FILTER} writable={false} />);
  const region = screen.getByRole("region", { name: /Campaigns, scroll/ });
  expect(observers[0].options?.root).toBe(region);
  expect(observers[0].observe).toHaveBeenCalledWith(region.querySelector(".campaigns-end"));
  expect(region.contains(screen.getByRole("button", { name: "Load more" }))).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { observers[0].callback([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver); });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { observers[0].callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver); });
  expect(fetch.mock.calls[0][0]).toContain("cursor=page-2");
  expect(container.querySelectorAll("[data-live-id]")).toHaveLength(4);
  expect(observers[0].disconnect).toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Load more" })); });
  expect(fetch.mock.calls[1][0]).toContain("cursor=page-3");
  expect(container.querySelectorAll("[data-live-id]")).toHaveLength(5);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("anchors a refresh to the first visible row and adjusts the inner scroller instead of the window", async () => {
  let release!: (response: Response) => void;
  const fetch = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { release = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const scrollWindow = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  const { container } = render(<LiveCampaigns initial={page({ nextCursor: null })} filter={DEFAULT_CAMPAIGN_FILTER} writable={false} />);
  const region = screen.getByRole("region", { name: /Campaigns, scroll/ });
  region.scrollTop = 200;
  vi.spyOn(region, "getBoundingClientRect").mockReturnValue(rect(150, 600));
  vi.spyOn(region.querySelector("thead th")!, "getBoundingClientRect").mockReturnValue(rect(150, 190));
  const elements = container.querySelectorAll<HTMLElement>("[data-live-id]");
  vi.spyOn(elements[0], "getBoundingClientRect").mockReturnValue(rect(100, 160));
  const visible = vi.spyOn(elements[1], "getBoundingClientRect").mockReturnValue(rect(190, 250));
  vi.spyOn(elements[2], "getBoundingClientRect").mockReturnValue(rect(250, 310));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetch.mock.calls[0][0]).toContain("anchor=campaign-1");
  // The row moves only once React commits the updated content. Measuring the
  // old DOM before that commit must not count as a successful restoration.
  visible.mockImplementation(() => elements[1].textContent?.includes("Updated campaign") ? rect(230, 290) : rect(190, 250));
  await act(async () => { release(Response.json(page({ rows: rows.map((row, index) => index === 1 ? { ...row, name: "Updated campaign" } : row), revision: "2", nextCursor: null }))); });
  expect(region.scrollTop).toBe(240);
  expect(scrollWindow).not.toHaveBeenCalled();
});

it("starts a newly filtered result at the top of the inner table", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(page({ rows: [rows[2]], total: 1, nextCursor: null })));
  vi.stubGlobal("fetch", fetch);
  render(<LiveCampaigns initial={page({ nextCursor: null })} filter={DEFAULT_CAMPAIGN_FILTER} writable={false} />);
  const region = screen.getByRole("region", { name: /Campaigns, scroll/ });
  region.scrollTop = 300;
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Campaign 2" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(fetch.mock.calls[0][0]).toContain("q=Campaign+2");
  expect(fetch.mock.calls[0][0]).not.toContain("anchor=");
  expect(region.scrollTop).toBe(0);
  expect(screen.queryByRole("link", { name: "Preview Campaign 0" })).toBeNull();
  expect(screen.getByRole("link", { name: "Preview Campaign 2" })).toBeTruthy();
});

it("watches the window, not the table, once the phone layout lays the rows out in full", async () => {
  matchPhone();
  const fetch = vi.fn().mockResolvedValue(Response.json(page({ rows: [{ ...rows[0], slug: "campaign-4", name: "Campaign 4" }], nextCursor: null })));
  vi.stubGlobal("fetch", fetch);
  const { container } = render(<LiveCampaigns initial={page()} filter={DEFAULT_CAMPAIGN_FILTER} writable={false} />);
  const region = screen.getByRole("region", { name: /Campaigns, scroll/ });
  // An observer rooted on the table would never stop intersecting once that
  // table no longer scrolls, and would load every page by itself.
  const observer = observers.at(-1)!;
  expect(observer.options?.root ?? null).toBeNull();
  expect(observer.observe).toHaveBeenCalledWith(region.querySelector(".campaigns-end"));
  await act(async () => { observer.callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver); });
  expect(fetch.mock.calls[0][0]).toContain("cursor=page-2");
  expect(container.querySelectorAll("[data-live-id]")).toHaveLength(4);
});

it("anchors a refresh to the window when the phone layout lays the rows out in full", async () => {
  matchPhone();
  let release!: (response: Response) => void;
  const fetch = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { release = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const scrollWindow = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  // Held rather than run on the spot: the restore has to measure the rows React
  // has committed, which is the whole reason it waits for a frame.
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  const { container } = render(<LiveCampaigns initial={page({ nextCursor: null })} filter={DEFAULT_CAMPAIGN_FILTER} writable={false} />);
  const region = screen.getByRole("region", { name: /Campaigns, scroll/ });
  const elements = container.querySelectorAll<HTMLElement>("[data-live-id]");
  const visible = vi.spyOn(elements[0], "getBoundingClientRect").mockReturnValue(rect(100, 160));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  // No scroller to measure against, so the first row on the page is the anchor.
  expect(fetch.mock.calls[0][0]).toContain("anchor=campaign-0");
  visible.mockImplementation(() => elements[0].textContent?.includes("Updated campaign") ? rect(140, 200) : rect(100, 160));
  await act(async () => { release(Response.json(page({ rows: rows.map((row, index) => index === 0 ? { ...row, name: "Updated campaign" } : row), revision: "2", nextCursor: null }))); });
  await act(async () => { for (const frame of frames) frame(0); });
  expect(scrollWindow).toHaveBeenCalledWith(0, 40);
  expect(region.scrollTop).toBe(0);
});
