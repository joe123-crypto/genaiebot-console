// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLivePoll } from "@/app/_components/use-live";
import { useLivePage } from "@/app/_components/live-page";
const sync = { stale: false, revision: "1", state: "live" as const, syncedAt: "2026-11-10T00:00:00Z" };
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function Poll({ read }: { read: (signal: AbortSignal) => Promise<void> }) { useLivePoll(read); return null; }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function visibility(value: string) {
  await act(async () => { Object.defineProperty(document, "visibilityState", { configurable: true, value }); document.dispatchEvent(new Event("visibilitychange")); });
}
describe("targeted live polling", () => {
  it("waits thirty seconds, pauses hidden/offline views and resumes once", async () => {
    const read = vi.fn(async () => {}); render(<Poll read={read} />);
    await advance(29_999); expect(read).not.toHaveBeenCalled();
    await advance(1); expect(read).toHaveBeenCalledTimes(1);
    await visibility("hidden"); await advance(120_000); expect(read).toHaveBeenCalledTimes(1);
    await visibility("visible"); expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not overlap slow polls and aborts them before checking a saved change", async () => {
    const signals: AbortSignal[] = [];
    const read = vi.fn((signal: AbortSignal) => { signals.push(signal); return new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); });
    const view = render(<Poll read={read} />);
    await advance(30_000); await advance(120_000); expect(read).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event("genaie:changed")));
    expect(signals[0].aborted).toBe(true); expect(read).toHaveBeenCalledTimes(2);
    view.unmount(); expect(signals[1].aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
});
function Page({ query = "", internalScroll = false }: { query?: string; internalScroll?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const data = useLivePage("groups", { rows: [{ jid: "1@g.us", name: "Initial" }], revision: "1", sync, nextCursor: "next" }, query, row => row.jid, root, undefined, internalScroll ? root : undefined);
  return <div ref={root}>{data.rows.map(row => <p data-live-id={row.jid} key={row.jid}>{row.name}</p>)}
    {data.error ? <p role="alert">{data.error}</p> : null}<button onClick={data.loadMore}>More</button></div>;
}
describe("indexed page requests", () => {
  it("uses the cursor for more rows and does not refetch the initial page", async () => {
    const fetch = vi.fn(async (_url: string) => Response.json({ rows: [{ jid: "2@g.us", name: "Next" }], revision: "1", sync, nextCursor: null })); vi.stubGlobal("fetch", fetch);
    render(<Page />); expect(fetch).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByText("More")));
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toContain("cursor=next");
    expect(screen.getByText("Initial")).toBeTruthy(); expect(screen.getByText("Next")).toBeTruthy();
  });
  it("retains data on failure and accepts unchanged freshness without clearing rows", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "Sync unavailable" }, { status: 503 }))
      .mockResolvedValue(Response.json({ unchanged: true, revision: "1", sync })); vi.stubGlobal("fetch", fetch);
    render(<Page />); await advance(30_000);
    expect(screen.getByText("Initial")).toBeTruthy(); expect(screen.getByRole("alert").textContent).toBe("Sync unavailable");
    await advance(30_000); expect(screen.getByText("Initial")).toBeTruthy(); expect(screen.queryByRole("alert")).toBeNull();
    expect(fetch.mock.calls[1][0]).toContain("since=1");
  });
  it("discards a late response from an old query", async () => {
    let release!: (response: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }))
      .mockResolvedValue(Response.json({ rows: [{ jid: "3@g.us", name: "Filtered" }], revision: "2", sync })); vi.stubGlobal("fetch", fetch);
    const view = render(<Page />); await advance(30_000);
    view.rerender(<Page query="q=Filtered" />);
    await act(async () => release(Response.json({ rows: [{ jid: "4@g.us", name: "Late" }], revision: "old", sync })));
    await advance(20);
    expect(screen.queryByText("Late")).toBeNull(); expect(screen.getByText("Filtered")).toBeTruthy();
  });
});

it.each([false, true])("anchors live updates inside the list without scrolling a closed panel or the window (hidden=%s)", async (hidden) => {
  const windowScroll = vi.fn(); vi.stubGlobal("scrollBy", windowScroll);
  let release!: (response: Response) => void;
  const fetch = vi.fn((_url: string) => new Promise<Response>(resolve => { release = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const view = render(<Page internalScroll />);
  const root = view.container.firstElementChild as HTMLDivElement;
  const row = root.querySelector("[data-live-id]") as HTMLElement;
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 400, width: 400, height: bottom - top, x: 0, y: top, toJSON() {} });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(100, 300));
  vi.spyOn(row, "getClientRects").mockImplementation(() => (row.hidden ? [] : [rect(110, 150)]) as unknown as DOMRectList);
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => rect(row.textContent === "Updated" ? 140 : 110, 180));
  root.scrollTop = 200;
  await advance(30_000);
  expect(fetch.mock.calls[0][0]).toContain("anchor=1%40g.us");
  row.hidden = hidden;
  await act(async () => { release(Response.json({ rows: [{ jid: "1@g.us", name: "Updated" }], revision: "2", sync })); });
  expect(root.scrollTop).toBe(hidden ? 200 : 230);
  expect(windowScroll).not.toHaveBeenCalled();
});
