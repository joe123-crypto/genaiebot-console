// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EntryTimeline } from "@/app/schedule/_components/entry-timeline";
import { TimezoneProvider } from "@/app/_components/timezone-context";
import type { DaySlot } from "@/src/domains/schedule";
import {
  botMinutes, displayClock, displaySlotLabel, displayStamp, displayTimelineClock,
  isDisplayTimezone, zoneOffsetMinutes, zoneShiftMinutes,
} from "@/src/lib/timezone";

const mock = vi.hoisted(() => ({ save: vi.fn(), saveTimes: vi.fn(), notify: vi.fn() }));
vi.mock("@/app/schedule/actions", () => ({ saveScheduleEntriesAction: mock.save, saveScheduleAction: mock.saveTimes }));
vi.mock("@/app/_components/use-live", () => ({ notifyLiveChange: mock.notify }));

const HARARE = "Africa/Harare";
const ALGIERS = "Africa/Algiers";
const midwinter = new Date("2026-01-15T12:00:00Z");
const midsummer = new Date("2026-07-15T12:00:00Z");

describe("reading the same moment on either clock", () => {
  it("knows what each zone is doing, in both halves of the year", () => {
    for (const at of [midwinter, midsummer]) {
      expect(zoneOffsetMinutes(at, HARARE)).toBe(120);
      expect(zoneOffsetMinutes(at, ALGIERS)).toBe(60);
      expect(zoneOffsetMinutes(at, "UTC")).toBe(0);
    }
  });

  it("shifts an hour between them and nothing against itself", () => {
    expect(zoneShiftMinutes(HARARE, ALGIERS, midwinter)).toBe(-60);
    expect(zoneShiftMinutes(ALGIERS, HARARE, midwinter)).toBe(60);
    expect(zoneShiftMinutes(HARARE, HARARE, midwinter)).toBe(0);
  });

  it("shows the time unshifted rather than nothing when a zone is unknown", () => {
    expect(zoneShiftMinutes("Nowhere/Nothing", ALGIERS, midwinter)).toBe(0);
  });

  it("wraps a clock pushed out of its day at either end", () => {
    expect(displayClock(540, -60)).toBe("08:00");
    expect(displayClock(30, -60)).toBe("23:30");
    expect(displayClock(1410, 60)).toBe("00:30");
  });

  it("says which day a run that leaves its own ends up in", () => {
    expect(displayTimelineClock(1470, 0)).toBe("00:30 (+1 day)");
    expect(displayTimelineClock(1470, -60)).toBe("23:30");
    expect(displayTimelineClock(30, -60)).toBe("23:30 (−1 day)");
  });

  it("takes a time the operator typed back to the bot's own clock", () => {
    expect(botMinutes(480, -60)).toBe(540);
    expect(botMinutes(1410, -60)).toBe(30);
    expect(botMinutes(displayClockMinutes("23:30"), 60)).toBe(1350);
  });

  it("prints a campaign on the chosen clock, converting from its own zone", () => {
    expect(displaySlotLabel({ hour: 9, minute: 0, timezone: HARARE }, ALGIERS)).toBe("08:00");
    expect(displaySlotLabel({ hour: 9, minute: 0, timezone: HARARE }, HARARE)).toBe("09:00");
    expect(displaySlotLabel({ hour: null, minute: null, timezone: HARARE }, ALGIERS)).toBe("--:--");
  });

  it("stamps a moment with the zone it is being read in", () => {
    expect(displayStamp("2026-11-08T06:00:00.000Z", HARARE)).toBe(`2026-11-08 08:00 ${HARARE}`);
    expect(displayStamp("2026-11-08T06:00:00.000Z", ALGIERS)).toBe(`2026-11-08 07:00 ${ALGIERS}`);
    expect(displayStamp(null, ALGIERS)).toBe("Unavailable");
    expect(displayStamp("not a date", ALGIERS, "Unknown")).toBe("Unknown");
  });

  it("accepts only the zones the console offers", () => {
    expect(isDisplayTimezone(ALGIERS)).toBe(true);
    expect(isDisplayTimezone("UTC")).toBe(false);
    expect(isDisplayTimezone(undefined)).toBe(false);
  });
});

const displayClockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
function basic(slug: string, minutes: number): DaySlot {
  return { slug, minutes, time: clock(minutes), name: slug, accounts: { default: 5 }, targetCount: 5,
    scheduleEdit: { revision: "a".repeat(64), editable: true, status: "ready", confirmedMinutes: minutes } } as DaySlot;
}
const props = { slots: [basic("alpha", 540)], nowMinutes: 480, date: "2026-11-10", timezone: HARARE,
  entriesUnavailableReason: "Deploy the companion bot update for repeat, pause, skip and delete controls." };
const inAlgiers = () => render(<TimezoneProvider zone={ALGIERS}><EntryTimeline {...props} /></TimezoneProvider>);

beforeAll(() => {
  class TestPointerEvent extends MouseEvent { pointerId = 1; }
  Object.assign(window, { PointerEvent: TestPointerEvent });
  Object.assign(globalThis, { PointerEvent: TestPointerEvent });
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1440, height: 20, top: 0, left: 0, right: 1440, bottom: 20, x: 0, y: 0, toJSON() {} });
});
beforeEach(() => {
  mock.saveTimes.mockImplementation(async (request: { changes: { slug: string; time: string }[] }) => ({ ok: true,
    campaigns: request.changes.map((change) => ({ slug: change.slug, minutes: displayClockMinutes(change.time),
      scheduleEdit: { revision: "b".repeat(64), editable: true, status: "ready", confirmedMinutes: displayClockMinutes(change.time) } })) }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("the day timeline read in Algiers", () => {
  it("shows a Harare run an hour earlier while the bar stays where the bot put it", () => {
    inAlgiers();
    expect(screen.getByText("08:00")).toBeDefined();
    // Midnight in the campaign day sits where it always did, labelled 23:00.
    expect(screen.getAllByText("23:00").map((mark) => mark.getAttribute("style")))
      .toEqual(["left: 0%;", "left: 100%;"]);
    // The axis is the campaign day, so the bar has not moved -- only its label.
    expect(screen.getByRole("slider", { name: /Alpha run 1 start time/ }).getAttribute("aria-valuenow")).toBe("540");
    expect(screen.getByText(`Campaign day planned in ${HARARE}.`)).toBeDefined();
  });

  it("saves the time the bot keeps, not the one on screen", async () => {
    inAlgiers();
    fireEvent.keyDown(screen.getByRole("slider", { name: /Alpha run 1 start time/ }), { key: "ArrowRight" });
    expect(screen.getByText("08:05")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mock.notify).toHaveBeenCalledOnce());
    expect(mock.saveTimes).toHaveBeenCalledWith({ date: "2026-11-10", timezone: HARARE,
      changes: [{ slug: "alpha", time: "09:05", expectedRevision: "a".repeat(64) }] });
  });

  it("reads a typed start time on the operator's clock", () => {
    inAlgiers();
    fireEvent.click(screen.getByRole("slider", { name: /Alpha run 1 start time/ }));
    const input = screen.getByLabelText("Start time") as HTMLInputElement;
    expect(input.value).toBe("08:00");
    fireEvent.change(input, { target: { value: "10:00" } });
    expect(screen.getByRole("slider", { name: /Alpha run 1 start time/ }).getAttribute("aria-valuenow")).toBe("660");
  });
});
