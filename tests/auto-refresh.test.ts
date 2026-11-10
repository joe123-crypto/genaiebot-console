// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AutoRefresh } from "@/app/_components/auto-refresh";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("shows resource polling status without triggering full-page requests", async () => {
  vi.useFakeTimers(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  render(createElement(AutoRefresh));
  expect(screen.getByRole("status").textContent).toBe("Live updates · 30s");
  await act(async () => { vi.advanceTimersByTime(3_600_000); });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(screen.getByRole("status").textContent).toBe("Updates paused");
  expect(vi.getTimerCount()).toBe(0);
});
