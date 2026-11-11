// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LiveScheduleView } from "@/app/schedule/_components/live-schedule";
import type { WriteCapabilities } from "@/src/lib/types";
const LIVE = { enabled: true, affectsProduction: true, fields: {}, delete: [] };
const calls = vi.hoisted(() => ({ timeline: vi.fn() }));
vi.mock("@/app/schedule/_components/entry-timeline", () => ({ EntryTimeline: (props: unknown) => { calls.timeline(props); return <p>Timeline</p>; } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const slots = [{ slug: "later", name: "Later", minutes: 900, time: "15:00", accounts: {}, targetCount: 2 },
  { slug: "earlier", name: "Earlier", minutes: 600, time: "10:00", accounts: {}, targetCount: 2 }];
const initial = { revision: "1", date: "2026-11-10", timezone: "Africa/Harare",
  sync: { revision: "1", syncedAt: "2026-11-10T11:00:00Z", stale: false, state: "live" as const }, slots };

it("passes occurrences without time-based row sorting and advances the clock without fetching", async () => {
  vi.useFakeTimers(); const fetch = vi.fn().mockResolvedValue(Response.json({ unchanged: true, revision: "1", sync: { stale: false } })); vi.stubGlobal("fetch", fetch);
  render(<LiveScheduleView initial={initial} writable={false} />);
  expect(screen.getByText("Timeline")).toBeTruthy();
  expect(calls.timeline.mock.lastCall?.[0].slots.map((slot: { slug: string }) => slot.slug)).toEqual(["later", "earlier"]);
  await act(async () => { vi.advanceTimersByTime(15_000); }); expect(fetch).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain("/api/live/schedule?since=1");
});

/** One timeline for both bot generations: the two capabilities arrive as separate reasons so a
 * bot that can move times but not act on entries keeps its drag and save. */
it("reports the two write capabilities separately", () => {
  const writes: WriteCapabilities = { ...LIVE, scheduleEditing: { edit: true } };
  render(<LiveScheduleView initial={{ ...initial, writes }} writable={true} />);
  const props = calls.timeline.mock.lastCall?.[0];
  expect(props.saveUnavailableReason).toBeUndefined();
  expect(props.entriesUnavailableReason).toBe("Deploy the companion bot update for repeat, pause, skip and delete controls.");
});

it("clears both reasons once the bot advertises entry support", () => {
  const writes: WriteCapabilities = { ...LIVE, scheduleEditing: { edit: true, entries: true } };
  render(<LiveScheduleView initial={{ ...initial, writes }} writable={true} />);
  const props = calls.timeline.mock.lastCall?.[0];
  expect(props.saveUnavailableReason).toBeUndefined();
  expect(props.entriesUnavailableReason).toBeUndefined();
});

it("refuses both when the console is read-only", () => {
  render(<LiveScheduleView initial={initial} writable={false} />);
  const props = calls.timeline.mock.lastCall?.[0];
  expect(props.saveUnavailableReason).toBe("The console is in read-only mode.");
  expect(props.entriesUnavailableReason).toBe("The console is in read-only mode.");
});
