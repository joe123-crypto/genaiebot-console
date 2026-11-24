// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateBot } from "@/app/setup/create-bot";

/**
 * What a workspace without a bot can do. The screen is the only thing between a
 * new sign-up and a console they cannot otherwise reach, so these cover the
 * states it has to draw and the one promise it makes: it never starts a second
 * run, and it never claims a simulated run created anything.
 */

const WORKSPACE = { id: "w9ayFMdvPw0Tmj0Zx", name: "Joseph Munemo's workspace" };
const fetchMock = vi.fn();

function answer(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => body };
}
const running = (stage: string) => ({ status: "running", stage, startedAt: "2026-11-24T09:00:00.000Z" });

function setup(enabled = true) {
  return render(createElement(CreateBot, { workspace: WORKSPACE, enabled }));
}
/** The component reads before it draws; let that first poll settle. */
async function settled() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(answer({ status: "idle" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the setup screen without a provisioner", () => {
  it("asks for nothing and hands over the workspace ID, calling no route", async () => {
    setup(false);
    await settled();
    expect(screen.getByRole("heading", { name: "No bot connected yet" })).toBeTruthy();
    expect(screen.getByText(WORKSPACE.id)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create my bot/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("creating a bot", () => {
  it("reads the run before offering to start one, so a reload rejoins it", async () => {
    fetchMock.mockResolvedValue(answer(running("seeding")));
    setup();
    await settled();
    expect(screen.getByRole("heading", { name: "Creating your bot" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create my bot/i })).toBeNull();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("method");
  });

  it("starts exactly one run however fast the button is clicked", async () => {
    setup();
    await settled();
    fetchMock.mockResolvedValue(answer(running("reserving")));
    const button = screen.getByRole("button", { name: "Create my bot" });
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    const starts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(starts).toHaveLength(1);
    expect(starts[0][1]).toMatchObject({ body: "{}" });
  });

  it("shows every stage, marking the one it has reached", async () => {
    fetchMock.mockResolvedValue(answer(running("seeding")));
    setup();
    await settled();
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps[1].className).toContain("is-done");
    expect(steps[2].className).toContain("is-current");
    expect(steps[2].getAttribute("aria-current")).toBe("step");
    expect(steps[3].className).toContain("is-pending");
  });

  it("sends the user on to link WhatsApp once there is a bot to pair against", async () => {
    fetchMock.mockResolvedValue(answer({ status: "ready", readyAt: "2026-11-24T09:01:00.000Z" }));
    setup();
    await settled();
    expect(screen.getByRole("heading", { name: "Your bot is ready" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /link your whatsapp number/i }).getAttribute("href")).toBe("/lines");
    expect(screen.queryByText(/simulated/i)).toBeNull();
  });

  it("never lets a simulated run pass for a bot that exists", async () => {
    fetchMock.mockResolvedValue(answer({ status: "ready", readyAt: "2026-11-24T09:01:00.000Z", simulated: true }));
    setup();
    await settled();
    expect(screen.getByText(/this run was simulated/i)).toBeTruthy();
  });

  it("gives the bot's own reason for a failure, and offers to try again", async () => {
    fetchMock.mockResolvedValue(answer({
      status: "failed", stage: "connecting",
      detail: "Your bot refused this workspace's token.", failedAt: "2026-11-24T09:01:00.000Z",
    }));
    setup();
    await settled();
    expect(screen.getByText("Your bot refused this workspace's token.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")[3].className).toContain("is-failed");
    fetchMock.mockResolvedValue(answer(running("reserving")));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("says what went wrong rather than drawing a state it could not read", async () => {
    fetchMock.mockResolvedValue(answer({ error: "Your workspace could not be loaded." }, false));
    setup();
    await settled();
    expect(screen.getByRole("alert").textContent).toContain("Your workspace could not be loaded.");
  });
});
