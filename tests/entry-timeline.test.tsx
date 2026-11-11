// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EntryTimeline } from "@/app/schedule/_components/entry-timeline";
import type { DaySlot } from "@/src/domains/schedule";
import type { ScheduleEntriesRequest } from "@/src/lib/types";

const mock = vi.hoisted(() => ({ save: vi.fn(), saveTimes: vi.fn(), notify: vi.fn() }));
vi.mock("@/app/schedule/actions", () => ({ saveScheduleEntriesAction: mock.save, saveScheduleAction: mock.saveTimes }));
vi.mock("@/app/_components/use-live", () => ({ notifyLiveChange: mock.notify }));

function slot(slug: string, entryId: string, minutes: number): DaySlot {
  return { slug, entryId, minutes, time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    name: slug, accounts: { default: 5 }, targetCount: 5, paused: false, skipped: false, deleted: false, campaignEnabled: true,
    recurrence: { timezone: "Africa/Harare", weekdays: [0, 1, 2, 3, 4, 5, 6] },
    confirmed: { minutes, paused: false, skipped: false, deleted: false },
    scheduleEdit: { revision: "a".repeat(64), editable: true, status: "ready", confirmedMinutes: minutes } };
}
const props = { slots: [slot("beta", "primary", 900), slot("alpha", "primary", 540), slot("alpha", "repeat", 660)], nowMinutes: 480, date: "2026-11-11", timezone: "Africa/Harare" };
const bar = (name = "Alpha run 1 start time") => screen.getByRole("slider", { name });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const mount = () => render(<EntryTimeline {...props} />);
beforeAll(() => {
  class TestPointerEvent extends MouseEvent { pointerId = 1; }
  Object.assign(window, { PointerEvent: TestPointerEvent });
  Object.assign(globalThis, { PointerEvent: TestPointerEvent });
  HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1440, height: 34, top: 0, left: 0, right: 1440, bottom: 34, x: 0, y: 0, toJSON() {} });
});
beforeEach(() => {
  mock.save.mockImplementation(async (request: ScheduleEntriesRequest) => ({ ok: true, operationId: request.operationId,
    entries: request.changes.map((change) => { const minutes = Number(change.time.slice(0, 2)) * 60 + Number(change.time.slice(3));
      return { ...slot(change.slug, change.entryId, minutes), ...change,
        confirmed: { minutes, paused: change.paused, skipped: change.skipped, deleted: change.deleted },
        scheduleEdit: { revision: "b".repeat(64), editable: true, status: "ready", confirmedMinutes: minutes } }; }) }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("independent timeline entries", () => {
  it("keeps repeat bars in a fixed campaign row through moves and server reordering", () => {
    const view = mount();
    expect([...view.container.querySelectorAll("[data-campaign]")].map((row) => row.getAttribute("data-campaign"))).toEqual(["alpha", "beta"]);
    expect(view.container.querySelector('[data-campaign="alpha"]')?.querySelectorAll('[role="slider"]').length).toBe(2);
    fireEvent.keyDown(bar(), { key: "PageUp" });
    view.rerender(<EntryTimeline {...props} slots={[...props.slots].reverse()} />);
    expect(bar().getAttribute("aria-valuenow")).toBe("600");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("opens by click or keyboard, edits exact minutes and restores focus on Escape", () => {
    mount(); fireEvent.click(bar());
    expect(screen.getByRole("dialog")).toBe(document.activeElement);
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "23:59" } });
    expect(bar().getAttribute("aria-valuenow")).toBe("1439");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(bar());
    fireEvent.keyDown(bar(), { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeDefined();
  });
  it("distinguishes drag from click and restores a cancelled drag", () => {
    mount(); const element = bar();
    fireEvent.pointerDown(element, { button: 0, clientX: 500 });
    fireEvent.pointerMove(element, { clientX: 530 });
    fireEvent.pointerUp(element, { clientX: 530 });
    fireEvent.click(element);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(element.getAttribute("aria-valuenow")).toBe("570");
    fireEvent.pointerDown(element, { button: 0, clientX: 500 });
    fireEvent.pointerMove(element, { clientX: 560 });
    fireEvent.pointerCancel(element);
    expect(element.getAttribute("aria-valuenow")).toBe("570");
  });
  it("stages pause and date-specific skip only for the chosen bar", async () => {
    mount(); fireEvent.click(bar()); click("Pause"); click("Skip this day");
    expect(bar().className).toContain("is-inactive");
    expect(bar("Alpha run 2 start time").className).not.toContain("is-inactive");
    expect(mock.save).not.toHaveBeenCalled(); click("Save changes");
    await waitFor(() => expect(mock.notify).toHaveBeenCalledOnce());
    expect(mock.save.mock.calls[0][0]).toMatchObject({ date: props.date, changes: [{ slug: "alpha", entryId: "primary", create: false, paused: true, skipped: true, deleted: false }] });
    fireEvent.click(bar()); click("Resume"); click("Undo skip");
    expect(bar().className).not.toContain("is-inactive");
  });
  it("pastes a daily repeat with a stable unique entry ID and preserves the source", async () => {
    const view = mount(); fireEvent.click(bar()); click("Copy");
    fireEvent.change(screen.getByLabelText("Paste time"), { target: { value: "14:25" } }); click("Paste daily repeat");
    expect(view.container.querySelector('[data-campaign="alpha"]')?.querySelectorAll('[role="slider"]').length).toBe(3);
    expect(screen.getByLabelText("Start time").getAttribute("value")).toBe("14:25");
    click("Save changes");
    await waitFor(() => expect(mock.notify).toHaveBeenCalledOnce());
    const input = mock.save.mock.calls[0][0] as ScheduleEntriesRequest;
    expect(input.changes).toHaveLength(1);
    expect(input.changes[0]).toMatchObject({ slug: "alpha", time: "14:25", create: true });
    expect(input.changes[0].entryId).not.toBe("primary");
    expect(input.changes[0].entryId).not.toBe("repeat");
  });
  it("pastes on an empty track time and Reset discards all staged actions", () => {
    const view = mount(); fireEvent.click(bar()); click("Copy");
    fireEvent.click(view.container.querySelector('[data-campaign="alpha"] .timeline-track')!, { clientX: 800 });
    expect(screen.getByLabelText("Start time").getAttribute("value")).toBe("13:20");
    click("Pause"); click("Reset");
    expect(screen.getAllByRole("slider")).toHaveLength(3);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("requires confirmation and deletes only a scheduled run", async () => {
    mount(); fireEvent.click(bar()); click("Delete scheduled run");
    expect(mock.save).not.toHaveBeenCalled(); click("Cancel");
    expect(screen.queryByRole("button", { name: "Confirm delete run" })).toBeNull();
    click("Delete scheduled run"); click("Confirm delete run"); click("Save changes");
    await waitFor(() => expect(screen.getAllByRole("slider")).toHaveLength(2));
    expect(mock.save.mock.calls[0][0].changes).toMatchObject([{ entryId: "primary", deleted: true }]);
  });
  it("retains and locks an uncertain paste, then retries the identical operation", async () => {
    mock.save.mockRejectedValueOnce(new Error("lost reply"));
    mount(); fireEvent.click(bar()); click("Copy"); click("Paste daily repeat"); click("Save changes");
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry original request" })).toBeDefined());
    expect((screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);
    click("Retry original request");
    await waitFor(() => expect(mock.notify).toHaveBeenCalledOnce());
    expect(mock.save.mock.calls[0][0]).toEqual(mock.save.mock.calls[1][0]);
    expect(screen.getAllByRole("slider")).toHaveLength(4);
  });
  it("preserves drafts on conflicts and blocks saving over refreshed revisions", async () => {
    mock.save.mockResolvedValueOnce({ ok: false, detail: "Conflict" });
    const view = mount(); fireEvent.keyDown(bar(), { key: "ArrowRight" }); click("Save changes");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Conflict"));
    expect(bar().getAttribute("aria-valuenow")).toBe("545");
    view.rerender(<EntryTimeline {...props} slots={props.slots.map((row) => ({ ...row, scheduleEdit: { ...row.scheduleEdit!, revision: "c".repeat(64) } }))} />);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("uses confirmed state until a saved pause reaches the scheduler", () => {
    const paused = { ...slot("alpha", "primary", 540), paused: true, scheduleEdit: { revision: "b".repeat(64), editable: true, status: "pending" as const, confirmedMinutes: 540 } };
    render(<EntryTimeline {...props} slots={[paused]} nowMinutes={545} />);
    expect(screen.getByText(/Alpha could still be sending/)).toBeDefined();
    expect(screen.getByText(/Last confirmed: 09:00/)).toBeDefined();
  });
  it("prevents duplicate submission and edits while saving", async () => {
    let finish!: (value: unknown) => void;
    mock.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    mount(); fireEvent.keyDown(bar(), { key: "ArrowRight" }); click("Save changes");
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(bar().getAttribute("aria-valuenow")).toBe("545");
    expect(mock.save).toHaveBeenCalledOnce();
    await act(async () => finish({ ok: false, detail: "Nothing saved" }));
  });
  it("allows inspecting bars in read-only mode without writes", () => {
    render(<EntryTimeline {...props} saveUnavailableReason="Read-only" />); fireEvent.click(bar());
    expect((screen.getByLabelText("Start time") as HTMLInputElement).disabled).toBe(true);
    click("Pause"); fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(bar().getAttribute("aria-valuenow")).toBe("540");
    expect(mock.save).not.toHaveBeenCalled();
  });
});
