// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DayTimeline } from "@/app/schedule/_components/day-timeline";
import type { DaySlot } from "@/src/domains/schedule";

/**
 * jsdom has neither PointerEvent nor pointer capture, so a drag cannot be
 * fired against it as-is. The stand-in extends MouseEvent, which is where the
 * clientX the drag measures actually comes from.
 */
class StubPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

/** One minute per pixel, so a drag reads as the number of minutes it moved. */
const TRACK_WIDTH = 24 * 60;

beforeAll(() => {
  Object.assign(globalThis, { PointerEvent: StubPointerEvent });
  Object.assign(window, { PointerEvent: StubPointerEvent });
  Object.assign(Element.prototype, {
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  });
  HTMLElement.prototype.getBoundingClientRect = function rect() {
    return { width: TRACK_WIDTH, height: 26, top: 0, left: 0, right: TRACK_WIDTH, bottom: 26, x: 0, y: 0, toJSON() {} };
  };
});

afterEach(cleanup);

/** Five groups is a 20-minute worst case, so 09:00 clears 10:00 but 09:45 does not. */
function slot(slug: string, minutes: number, accounts: Record<string, number> = { default: 5 }): DaySlot {
  return {
    slug,
    name: `${slug}-promo`,
    time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    minutes,
    targetCount: 5,
    accounts,
  };
}

const props = {
  slots: [slot("alpha", 540), slot("beta", 600)],
  nowMinutes: 480,
  timezone: "Africa/Harare",
};

function mount(overrides: Partial<typeof props> & { saveUnavailableReason?: string } = {}) {
  return render(createElement(DayTimeline, { ...props, ...overrides }));
}

function bar(name = "Alpha start time") {
  return screen.getByRole("slider", { name });
}

function drag(element: Element, pixels: number) {
  fireEvent.pointerDown(element, { button: 0, clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(element, { clientX: 500 + pixels, pointerId: 1 });
  fireEvent.pointerUp(element, { clientX: 500 + pixels, pointerId: 1 });
}

function overlapWarning() {
  return screen.queryByText("Two campaigns on one line could overlap.");
}

describe("dragging a run to a new time", () => {
  it("moves the bar by how far the pointer travelled, not to where it landed", () => {
    mount();
    drag(bar(), 30);
    expect(bar().getAttribute("aria-valuenow")).toBe("570");
    expect(screen.getByText("09:30")).toBeDefined();
  });

  it("snaps to five minutes, which is as finely as a pointer can aim a whole day", () => {
    mount();
    drag(bar(), 7);
    expect(bar().getAttribute("aria-valuenow")).toBe("545");
  });

  it("keeps the saved time beside the new one, and a mark where the bar was", () => {
    const view = mount();
    drag(bar(), 30);
    expect(screen.getByText("09:00").className).toContain("timeline-was");
    expect(view.container.querySelector(".timeline-ghost")).not.toBeNull();
    expect(bar().className).toContain("is-moved");
  });

  it("cannot be dragged off either end of the day", () => {
    mount();
    drag(bar(), -2000);
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
    drag(bar(), 2000);
    expect(bar().getAttribute("aria-valuenow")).toBe("1435");
  });

  it("steps five minutes by arrow key and one with shift, so a time can be aimed exactly", () => {
    mount();
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(bar().getAttribute("aria-valuenow")).toBe("545");
    fireEvent.keyDown(bar(), { key: "ArrowRight", shiftKey: true });
    expect(bar().getAttribute("aria-valuenow")).toBe("546");
    fireEvent.keyDown(bar(), { key: "PageDown" });
    expect(bar().getAttribute("aria-valuenow")).toBe("486");
    fireEvent.keyDown(bar(), { key: "Home" });
    expect(bar().getAttribute("aria-valuenow")).toBe("0");
  });

  it("keeps focus on a bar that was grabbed, so it can then be nudged", () => {
    mount();
    fireEvent.pointerDown(bar(), { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(bar(), { clientX: 500, pointerId: 1 });
    expect(document.activeElement).toBe(bar());
    fireEvent.keyDown(bar(), { key: "ArrowRight" });
    expect(bar().getAttribute("aria-valuenow")).toBe("545");
  });

  it("puts every bar back where the bot has it", () => {
    const view = mount();
    drag(bar(), 30);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(bar().getAttribute("aria-valuenow")).toBe("540");
    expect(view.container.querySelector(".timeline-ghost")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });
});

describe("what a drafted time says about the day", () => {
  it("warns about an overlap before anything is saved, and clears it again", () => {
    mount();
    expect(overlapWarning()).toBeNull();
    drag(bar(), 45);
    expect(overlapWarning()).not.toBeNull();
    expect(screen.getByText(/can still be sending at/).textContent).toContain("10:05");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(overlapWarning()).toBeNull();
  });

  it("leaves the other line alone", () => {
    mount({ slots: [slot("alpha", 540), slot("beta", 600, { ads: 5 })] });
    drag(bar(), 45);
    expect(overlapWarning()).toBeNull();
  });

  it("says a drafted run would be sending rather than that it is", () => {
    mount({ nowMinutes: 605 });
    expect(screen.getByText("Running now")).toBeDefined();
    drag(bar("Beta start time"), 5);
    expect(screen.queryByText("Running now")).toBeNull();
    expect(screen.getByText("Would be running")).toBeDefined();
    expect(screen.getByText(/could still be sending/).textContent).toContain("If saved:");
  });
});

describe("saving", () => {
  it("offers the save switched off, and says why", () => {
    mount({ saveUnavailableReason: "Not connected to the bot yet." });
    drag(bar(), 30);
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Not connected to the bot yet.");
    expect(screen.getByText("Not connected to the bot yet.")).toBeDefined();
  });

  it("has nothing to save until a bar has moved", () => {
    mount();
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    drag(bar(), 30);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("refuses to save over a schedule that moved underneath the draft", () => {
    const view = mount();
    drag(bar(), 30);
    view.rerender(createElement(DayTimeline, { ...props, slots: [slot("alpha", 555), slot("beta", 600)] }));
    expect(screen.getByRole("alert").textContent).toContain("The schedule changed while you were editing");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
