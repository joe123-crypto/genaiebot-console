// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MOBILE_LAYOUT_QUERY, useMobileLayout } from "@/app/_components/use-mobile-layout";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Probe() {
  return <p>{useMobileLayout() ? "phone" : "desktop"}</p>;
}

/** A matchMedia that answers for a viewport width and can be resized. */
function stubViewport(width: number) {
  const listeners = new Set<() => void>();
  let current = width;
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    get matches() { return media === MOBILE_LAYOUT_QUERY && current <= 760; },
    addEventListener: (_: string, read: () => void) => listeners.add(read),
    removeEventListener: (_: string, read: () => void) => listeners.delete(read),
  }));
  return { resize(next: number) { current = next; listeners.forEach(read => read()); } };
}

it("reports the desktop layout where matchMedia says nothing, so the server and jsdom agree", () => {
  vi.stubGlobal("matchMedia", undefined);
  render(<Probe />);
  expect(screen.getByText("desktop")).toBeTruthy();
});

it("reports the phone layout at a phone's width and follows a resize", () => {
  const viewport = stubViewport(375);
  render(<Probe />);
  expect(screen.getByText("phone")).toBeTruthy();
  act(() => viewport.resize(1280));
  expect(screen.getByText("desktop")).toBeTruthy();
});

it("reports the desktop layout above the phone width", () => {
  stubViewport(1280);
  render(<Probe />);
  expect(screen.getByText("desktop")).toBeTruthy();
});
