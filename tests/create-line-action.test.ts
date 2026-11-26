import { TEST_ACTOR } from "./auth-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

const getAccounts = vi.fn();
const getConfiguration = vi.fn();
const updateLine = vi.fn();
const updateSettings = vi.fn();
const revalidate = vi.fn();

/** The gateway's view of a line: linked, with the number WhatsApp reports. */
const live = (overrides: Record<string, unknown> = {}) => ({
  id: "default", number: "263785632943", enabled: true, linked: true, running: true,
  connected: true, repliesEnabled: true, configured: true, startBlockedReason: null,
  hasError: false, pairingSessionId: null, ...overrides,
});

async function loadAction(writes = true) {
  vi.resetModules();
  for (const fn of [getAccounts, getConfiguration, updateLine, updateSettings, revalidate]) fn.mockReset();
  vi.doMock("@/src/config", () => ({ WRITES_ENABLED: writes }));
  vi.doMock("next/cache", () => ({ revalidatePath: revalidate }));
  vi.doMock("@/src/lib/account-client", () => ({ getAccounts, AccountApiError: class extends Error {} }));
  vi.doMock("@/src/lib/bot-client", () => ({ getConfiguration, updateLine, updateSettings }));
  getAccounts.mockResolvedValue({ observedAt: "2026-11-26T00:00:00Z", accounts: [live()] });
  getConfiguration.mockResolvedValue({ accounts: [] });
  updateLine.mockResolvedValue({});
  return (await import("@/app/lines/actions")).createLineAction;
}

afterEach(() => {
  vi.resetModules();
  for (const name of ["@/src/config", "next/cache", "@/src/lib/account-client", "@/src/lib/bot-client"]) vi.doUnmock(name);
});

describe("createLineAction", () => {
  it("refuses read-only requests without contacting the bot", async () => {
    const create = await loadAction(false);
    expect(await create("default")).toEqual({ ok: false, detail: "The console is in read-only mode." });
    expect(getAccounts).not.toHaveBeenCalled();
    expect(updateLine).not.toHaveBeenCalled();
  });

  it.each(["../settings", "", "Default", null])("rejects a malformed line name (%s)", async (bad) => {
    const create = await loadAction();
    expect(await create(bad as string)).toEqual({ ok: false, detail: "No valid line was named." });
    expect(updateLine).not.toHaveBeenCalled();
  });

  it("writes the number the linked account itself reports", async () => {
    const create = await loadAction();
    expect(await create("default")).toEqual({ ok: true });
    expect(updateLine).toHaveBeenCalledWith("default", { number: "+263785632943" }, { by: TEST_ACTOR });
    expect(revalidate).toHaveBeenCalledWith("/lines");
    expect(revalidate).toHaveBeenCalledWith("/groups", "layout");
  });

  it("never makes the first line the contact line on its own", async () => {
    const create = await loadAction();
    await create("default");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("leaves a line the bot already configures exactly as it is", async () => {
    const create = await loadAction();
    getConfiguration.mockResolvedValue({ accounts: [{ id: "default", number: "+263785632943", isContact: true }] });
    expect(await create("default")).toEqual({ ok: true });
    expect(updateLine).not.toHaveBeenCalled();
  });

  it.each([
    [{ linked: false }, "This line has no WhatsApp login yet. Link it first."],
    [{ linked: null }, "This line has no WhatsApp login yet. Link it first."],
    [{ configured: false }, "The gateway has no account for this line yet. Link it first."],
    [{ number: null }, "WhatsApp reports no number for this line yet. Refresh status shortly and try again."],
    [{ number: "" }, "WhatsApp reports no number for this line yet. Refresh status shortly and try again."],
  ])("writes nothing when the gateway reports %o", async (overrides, detail) => {
    const create = await loadAction();
    getAccounts.mockResolvedValue({ observedAt: "2026-11-26T00:00:00Z", accounts: [live(overrides)] });
    expect(await create("default")).toEqual({ ok: false, detail });
    expect(updateLine).not.toHaveBeenCalled();
  });

  it("does not invent a line the gateway has never heard of", async () => {
    const create = await loadAction();
    getAccounts.mockResolvedValue({ observedAt: "2026-11-26T00:00:00Z", accounts: [] });
    expect(await create("sales")).toEqual({
      ok: false, detail: "The gateway does not have this line. Refresh status before trying again.",
    });
    expect(updateLine).not.toHaveBeenCalled();
  });

  it("goes ahead against an older gateway that cannot say whether a line is configured", async () => {
    const create = await loadAction();
    const { configured: _omitted, ...older } = live();
    getAccounts.mockResolvedValue({ observedAt: "2026-11-26T00:00:00Z", accounts: [older] });
    expect(await create("default")).toEqual({ ok: true });
    expect(updateLine).toHaveBeenCalledWith("default", { number: "+263785632943" }, { by: TEST_ACTOR });
  });
});
