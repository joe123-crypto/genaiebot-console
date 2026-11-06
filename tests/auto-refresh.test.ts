// @vitest-environment jsdom

import { createElement, StrictMode, Suspense, use, useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoRefresh } from "@/app/_components/auto-refresh";

const { router } = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

let finishRefresh: (data?: string) => void;

/** Simulate a router refresh suspending until a new server payload arrives. */
function ConsoleHarness() {
  const [payload, setPayload] = useState<Promise<string> | null>(null);
  router.refresh.mockImplementation(() => {
    setPayload(new Promise<string>((resolve) => {
      finishRefresh = (data = "Updated") => resolve(data);
    }));
  });
  const data = payload ? use(payload) : "Initial";
  return createElement("div", null,
    createElement(AutoRefresh),
    createElement("p", null, `${data} page and sidebar`),
    createElement("input", { "aria-label": "Operator note", defaultValue: "Keep me" }),
  );
}

function mount() {
  return render(createElement(StrictMode, null,
    createElement(Suspense, { fallback: "Loading" }, createElement(ConsoleHarness)),
  ));
}

async function advance(ms = 60_000) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

async function visibility(value: DocumentVisibilityState) {
  await act(async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function online(value: boolean) {
  await act(async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value });
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  router.refresh.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("console automatic updates", () => {
  it("waits a minute, preserves current content during refresh, then updates the payload", async () => {
    mount();
    const input = screen.getByRole("textbox");
    (input as HTMLInputElement).value = "Unsaved operator note";
    expect(screen.getByRole("status").textContent).toBe("Updates every 60s");
    await advance(59_999);
    expect(router.refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("Updating…");
    expect(screen.getByText("Initial page and sidebar")).toBeTruthy();
    await act(async () => finishRefresh());
    expect(screen.getByText("Updated page and sidebar")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBe(input);
    expect((input as HTMLInputElement).value).toBe("Unsaved operator note");
    expect(screen.getByRole("status").textContent).toBe("Updates every 60s");
  });

  it("does not overlap slow refreshes and waits a full minute after completion", async () => {
    mount();
    await advance();
    await advance(180_000);
    await visibility("hidden");
    await visibility("visible");
    await online(false);
    await online(true);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => finishRefresh());
    await advance(59_999);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("pauses hidden tabs and refreshes once on return", async () => {
    mount();
    await advance(20_000);
    await visibility("hidden");
    expect(screen.getByRole("status").textContent).toBe("Updates paused");
    await advance(180_000);
    expect(router.refresh).not.toHaveBeenCalled();
    await visibility("visible");
    await visibility("visible");
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("waits for both connectivity and visibility before resuming", async () => {
    await online(false);
    mount();
    expect(screen.getByRole("status").textContent).toBe("Updates paused");
    await advance();
    expect(router.refresh).not.toHaveBeenCalled();
    await visibility("hidden");
    await online(true);
    await advance();
    expect(router.refresh).not.toHaveBeenCalled();
    await visibility("visible");
    await online(true);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("cleans up timers and event listeners on unmount", async () => {
    const view = mount();
    view.unmount();
    await visibility("hidden");
    await online(false);
    await visibility("visible");
    await online(true);
    await advance(180_000);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues checking after the server renders a gateway error", async () => {
    mount();
    await advance();
    await act(async () => finishRefresh("Gateway unavailable"));
    expect(screen.getByText("Gateway unavailable page and sidebar")).toBeTruthy();
    await advance();
    expect(router.refresh).toHaveBeenCalledTimes(2);
    await act(async () => finishRefresh());
    expect(screen.getByText("Updated page and sidebar")).toBeTruthy();
  });
});
