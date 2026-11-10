// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LiveScheduleView } from "@/app/schedule/_components/live-schedule";
const calls = vi.hoisted(() => ({ timeline: vi.fn() }));
vi.mock("@/app/schedule/_components/day-timeline", () => ({ DayTimeline: (props: unknown) => { calls.timeline(props); return <p>Timeline</p>; } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("orders normalized occurrences before choosing the next campaign and advances the clock without fetching", async () => {
  vi.useFakeTimers(); const fetch = vi.fn().mockResolvedValue(Response.json({ unchanged: true, revision: "1", sync: { stale: false } })); vi.stubGlobal("fetch", fetch);
  const initial = { revision: "1", date: "2026-11-10", timezone: "Africa/Harare", sync: { revision: "1", syncedAt: "2026-11-10T11:00:00Z", stale: false, state: "live" as const },
    slots: [{ slug: "later", name: "Later", minutes: 900, time: "15:00", accounts: {}, targetCount: 2 },
      { slug: "earlier", name: "Earlier", minutes: 600, time: "10:00", accounts: {}, targetCount: 2 }] };
  render(<LiveScheduleView initial={initial} writable={false} />);
  expect(screen.getByText("Timeline")).toBeTruthy();
  expect(calls.timeline.mock.lastCall?.[0].slots.map((slot: { slug: string }) => slot.slug)).toEqual(["earlier", "later"]);
  await act(async () => { vi.advanceTimersByTime(15_000); }); expect(fetch).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain("/api/live/schedule?since=1");
});
