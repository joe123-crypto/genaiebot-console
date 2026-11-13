// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { EntryTimeline } from "@/app/schedule/_components/entry-timeline";
import type { DaySlot } from "@/src/domains/schedule";

const mock = vi.hoisted(() => ({ save: vi.fn(), saveTimes: vi.fn(), notify: vi.fn() }));
vi.mock("@/app/schedule/actions", () => ({ saveScheduleEntriesAction: mock.save, saveScheduleAction: mock.saveTimes }));
vi.mock("@/app/_components/use-live", () => ({ notifyLiveChange: mock.notify }));

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** A slot exactly as a bot without entry support sends it: no entryId, no paused/skipped/
 * deleted/recurrence/confirmed. Everything entry-only is absent, not false. */
function basic(slug: string, minutes: number, extra: Partial<DaySlot> = {}): DaySlot {
  return { slug, minutes, time: clock(minutes), name: slug, accounts: { default: 5 }, targetCount: 5,
    scheduleEdit: { revision: "a".repeat(64), editable: true, status: "ready", confirmedMinutes: minutes }, ...extra } as DaySlot;
}
const ENTRIES_OFF = "Deploy the companion bot update for repeat, pause, skip and delete controls.";
const props = { slots: [basic("alpha", 540), basic("beta", 900)], nowMinutes: 480, date: "2026-11-10",
  timezone: "Africa/Harare", entriesUnavailableReason: ENTRIES_OFF };
const bar = (name = "Alpha run 1 start time") => screen.getByRole("slider", { name });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const mount = (over: Partial<ComponentProps<typeof EntryTimeline>> = {}) => render(<EntryTimeline {...props} {...over} />);
const drag = (element: HTMLElement, pixels: number) => {
  fireEvent.pointerDown(element, { button: 0, clientX: 500 });
  fireEvent.pointerMove(element, { clientX: 500 + pixels });
  fireEvent.pointerUp(element, { clientX: 500 + pixels });
};

beforeAll(() => {
  class TestPointerEvent extends MouseEvent { pointerId = 1; }
  Object.assign(window, { PointerEvent: TestPointerEvent });
  Object.assign(globalThis, { PointerEvent: TestPointerEvent });
  // One minute per pixel, so a drag reads as the minutes it moves.
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1440, height: 20, top: 0, left: 0, right: 1440, bottom: 20, x: 0, y: 0, toJSON() {} });
});
beforeEach(() => {
  mock.saveTimes.mockImplementation(async (request: { changes: { slug: string; time: string }[] }) => ({ ok: true,
    campaigns: request.changes.map((change) => ({ slug: change.slug,
      minutes: Number(change.time.slice(0, 2)) * 60 + Number(change.time.slice(3)),
      scheduleEdit: { revision: "b".repeat(64), editable: true, status: "ready", confirmedMinutes: Number(change.time.slice(0, 2)) * 60 + Number(change.time.slice(3)) } })) }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("a bot without entry support", () => {
  it("offers only the start time, not the entry actions", () => {
    mount(); fireEvent.click(bar());
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByLabelText("Start time")).toBeDefined();
    for (const name of ["Pause", "Skip this day", "Copy", "Paste daily repeat", "Delete scheduled run"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByText(ENTRIES_OFF)).toBeDefined();
  });

  it("still moves a bar by pointer, snapping to five minutes", () => {
    mount(); drag(bar(), 32);
    expect(bar().getAttribute("aria-valuenow")).toBe("570");
  });

  it("still steps by arrow key and cannot leave the day", () => {
    mount();
    fireEvent.keyDown(bar(), { key: "ArrowRight" }); expect(bar().getAttribute("aria-valuenow")).toBe("545");
    fireEvent.keyDown(bar(), { key: "ArrowRight", shiftKey: true }); expect(bar().getAttribute("aria-valuenow")).toBe("546");
    fireEvent.keyDown(bar(), { key: "Home" }); expect(bar().getAttribute("aria-valuenow")).toBe("0");
    fireEvent.keyDown(bar(), { key: "ArrowLeft" }); expect(bar().getAttribute("aria-valuenow")).toBe("0");
    fireEvent.keyDown(bar(), { key: "End" }); expect(bar().getAttribute("aria-valuenow")).toBe("1435");
  });

  it("opens the options on a click but not at the end of a drag", () => {
    mount(); const element = bar();
    drag(element, 30); fireEvent.click(element);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(element);
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("saves moved rows through the per-campaign action, not the entries action", async () => {
    mount(); fireEvent.keyDown(bar(), { key: "ArrowRight" }); click("Save changes");
    await waitFor(() => expect(mock.notify).toHaveBeenCalledOnce());
    expect(mock.save).not.toHaveBeenCalled();
    expect(mock.saveTimes).toHaveBeenCalledWith({ date: "2026-11-10", timezone: "Africa/Harare",
      changes: [{ slug: "alpha", time: "09:05", expectedRevision: "a".repeat(64) }] });
    expect(screen.getByText("Times saved and confirmed by the scheduler.")).toBeDefined();
    expect(bar().getAttribute("aria-valuenow")).toBe("545");
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("keeps the draft when the reply is lost", async () => {
    mock.saveTimes.mockRejectedValueOnce(new Error("lost reply"));
    mount(); fireEvent.keyDown(bar(), { key: "ArrowRight" }); click("Save changes");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("may have been saved"));
    expect(bar().getAttribute("aria-valuenow")).toBe("545");
    expect(screen.getByRole("button", { name: "Reset" })).toBeDefined();
  });

  it("keeps a refusal's reason and the draft behind it", async () => {
    mock.saveTimes.mockResolvedValueOnce({ ok: false, detail: "Conflict" });
    mount(); fireEvent.keyDown(bar(), { key: "ArrowRight" }); click("Save changes");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Conflict"));
    expect(bar().getAttribute("aria-valuenow")).toBe("545");
  });

  it("refuses to save over a schedule that moved underneath the draft", () => {
    const view = mount(); fireEvent.keyDown(bar(), { key: "ArrowRight" });
    view.rerender(<EntryTimeline {...props} slots={props.slots.map((row) => ({ ...row, scheduleEdit: { ...row.scheduleEdit!, revision: "c".repeat(64) } }))} />);
    expect(screen.getByRole("alert").textContent).toContain("The schedule changed while you were editing");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  /** The bot checks one expectedRevision per change, so a draft that only moves Alpha has no
   * stake in Beta. Digesting the whole day made an unrelated campaign's revision -- which the
   * bot rotates on any save of its own -- disable Save and the entry actions for good. */
  it("ignores a revision bump on a campaign the draft never touched", () => {
    const view = mount(); fireEvent.keyDown(bar(), { key: "ArrowRight" });
    view.rerender(<EntryTimeline {...props} slots={props.slots.map((row) => row.slug === "beta"
      ? { ...row, scheduleEdit: { ...row.scheduleEdit!, revision: "c".repeat(64) } } : row)} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports unsaved changes so the page can hold the poll still", () => {
    const onEditingChange = vi.fn();
    mount({ onEditingChange });
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Live updates are paused while you have unsaved changes.")).toBeDefined();
    click("Reset");
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  /** A draft that no longer differs from the server is not unsaved work. Holding the poll for
   * one stopped updates for the rest of the session while the page said "Saved schedule." */
  it("releases the poll when an edit is undone back to the saved time", () => {
    const onEditingChange = vi.fn();
    mount({ onEditingChange });
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(bar(), { key: "ArrowLeft" });
    expect(bar().getAttribute("aria-valuenow")).toBe("540");
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText("Live updates are paused while you have unsaved changes.")).toBeNull();
  });

  /** Holding the poll while a reply is lost would deadlock: `dirty` is measured against the
   * server's slots, and only a poll refreshes those. Reset is barred by `locked` there too. */
  it("releases the poll while a save reply is uncertain", async () => {
    const onEditingChange = vi.fn();
    mock.save.mockRejectedValueOnce(new Error("lost reply"));
    mount({ onEditingChange, entriesUnavailableReason: undefined });
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    click("Save changes");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("may have been saved"));
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "Retry original request" })).toBeDefined();
  });

  /** The regression this mode was most likely to hide: entry bots report the last confirmed run
   * as `confirmed`, older ones only as scheduleEdit.confirmedMinutes. Reading one and not the
   * other dropped pending runs out of the status line entirely. */
  it("uses scheduleEdit.confirmedMinutes for a pending run", () => {
    mount({ slots: [basic("alpha", 600, { scheduleEdit: { revision: "a".repeat(64), editable: true, status: "pending", confirmedMinutes: 540 } })], nowMinutes: 545 });
    expect(screen.getByText(/Last confirmed: 09:00/)).toBeDefined();
    expect(screen.getByText(/Alpha could still be sending/)).toBeDefined();
  });

  /** The confirmed time drives the status line, but the bar is still drawn at the unconfirmed
   * time, so highlighting it would call a run active an hour before it starts. */
  it("does not mark a bar drawn at an unconfirmed time as running", () => {
    mount({ slots: [basic("alpha", 600, { scheduleEdit: { revision: "a".repeat(64), editable: true, status: "pending", confirmedMinutes: 540 } })], nowMinutes: 545 });
    expect(screen.getByText(/Alpha could still be sending/)).toBeDefined();
    expect(bar().getAttribute("aria-valuenow")).toBe("600");
    expect(bar().className).not.toContain("is-running");
  });

  it("still marks a bar running when it is drawn at the time that is running", () => {
    mount({ slots: [basic("alpha", 540, { targetCount: 51 })], nowMinutes: 545 });
    expect(bar().className).toContain("is-running");
  });

  it("drops a pending run with no confirmed time from the day's status", () => {
    mount({ slots: [basic("alpha", 600, { scheduleEdit: { revision: "a".repeat(64), editable: true, status: "pending", confirmedMinutes: null } })], nowMinutes: 545 });
    expect(screen.getByText(/No confirmed run on this day/)).toBeDefined();
    expect(screen.getByText(/The day's runs are over/)).toBeDefined();
  });

  it("leaves a row the bot cannot edit alone, and says why", () => {
    mount({ slots: [basic("alpha", 540, { scheduleEdit: { revision: "a".repeat(64), editable: false, status: "ready", confirmedMinutes: 540, reason: "Multiple daily start times cannot be dragged." } })] });
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(bar().getAttribute("aria-valuenow")).toBe("540");
    expect(bar().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Multiple daily start times cannot be dragged.")).toBeDefined();
  });

  /** A slot with no edit contract would otherwise send expectedRevision "" and earn a
   * misleading "Invalid schedule change." from the action. */
  it("treats a row with no edit contract as uneditable", () => {
    const slot = { ...basic("alpha", 540) }; delete (slot as { scheduleEdit?: unknown }).scheduleEdit;
    mount({ slots: [slot as DaySlot] });
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(bar().getAttribute("aria-valuenow")).toBe("540");
    expect(bar().getAttribute("aria-disabled")).toBe("true");
  });

  it("warns about an overlap before anything is saved, and clears it again", () => {
    // alpha runs 09:00 and takes ~75m for 51 groups, so it is still sending at 10:15.
    mount({ slots: [basic("alpha", 540, { targetCount: 51 }), basic("beta", 660)] });
    expect(screen.queryByText("Two runs on one line could overlap.")).toBeNull();
    fireEvent.keyDown(bar("Beta run 1 start time"), { key: "PageDown" });
    expect(screen.getByText("Two runs on one line could overlap.")).toBeDefined();
    expect(screen.getByText(/can still be sending at/).textContent).toContain("10:15");
    fireEvent.keyDown(bar("Beta run 1 start time"), { key: "PageUp" });
    expect(screen.queryByText("Two runs on one line could overlap.")).toBeNull();
  });

  it("says so in the same place when nothing overlaps", () => {
    mount({ slots: [basic("alpha", 540, { targetCount: 51 }), basic("beta", 660)] });
    expect(screen.getByText("No overlaps.")).toBeDefined();
    fireEvent.keyDown(bar("Beta run 1 start time"), { key: "PageDown" });
    expect(screen.queryByText("No overlaps.")).toBeNull();
  });

  it("keeps the counts beside the overlap card in both states", () => {
    mount({ summary: <p>three counts</p>, slots: [basic("alpha", 540, { targetCount: 51 }), basic("beta", 660)] });
    expect(screen.getByText("three counts").parentElement?.className).toBe("schedule-summary");
    fireEvent.keyDown(bar("Beta run 1 start time"), { key: "PageDown" });
    expect(screen.getByText("three counts").parentElement?.className).toBe("schedule-summary");
  });

  it("offers the save switched off, and says why", () => {
    mount({ saveUnavailableReason: "The console is in read-only mode." });
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(bar().getAttribute("aria-valuenow")).toBe("540");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("The console is in read-only mode.")).toBeDefined();
  });

  it("preserves a draft across a clock refresh", () => {
    const view = mount(); fireEvent.keyDown(bar(), { key: "ArrowRight" });
    view.rerender(<EntryTimeline {...props} nowMinutes={481} />);
    expect(bar().getAttribute("aria-valuenow")).toBe("545");
    expect(screen.getByRole("button", { name: "Reset" })).toBeDefined();
  });

  it("draws a bar to its duration and labels a run that spills past midnight", () => {
    const view = mount({ slots: [basic("alpha", 1430, { targetCount: 51 })] });
    // 51 groups take ~75m, so a 23:50 start finishes after midnight.
    expect(view.container.querySelector(".timeline-range")?.textContent).toContain("(+1 day)");
    expect(bar().style.width).not.toBe("");
  });

  it("has nothing to save until a bar has moved", async () => {
    mount();
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
    click("Reset");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {});
    expect(mock.saveTimes).not.toHaveBeenCalled();
  });
});
