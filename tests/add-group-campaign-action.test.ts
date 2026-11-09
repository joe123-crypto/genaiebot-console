import { afterEach, describe, expect, it, vi } from "vitest";
import type { Group, WriteCapabilities } from "@/src/lib/types";

const getGroups = vi.fn();
const getOverview = vi.fn();
const updateGroup = vi.fn();
const revalidate = vi.fn();
const jid = "120363111@g.us";
const slug = "fruit-trees";

function group(overrides: Partial<Group> = {}): Group {
  return {
    jid, name: "Harare Market", source: "operator", status: "active", activity: "normal",
    account: "default", dailyCapOverride: null, promos: ["borehole-drilling"],
    weekly: { "borehole-drilling": ["mon"] }, pausedPromos: ["borehole-drilling"],
    note: null, cap: 4, replyScore: null, allowedToday: [], ...overrides,
  };
}

const capabilities: WriteCapabilities = {
  enabled: true, affectsProduction: true, fields: { groups: ["promos"] }, delete: [],
};

async function loadAction(writes = true) {
  vi.resetModules();
  for (const fn of [getGroups, getOverview, updateGroup, revalidate]) fn.mockReset();
  vi.doMock("@/src/config", () => ({ WRITES_ENABLED: writes, OPERATOR_NAME: "Joseph" }));
  vi.doMock("next/cache", () => ({ revalidatePath: revalidate }));
  vi.doMock("@/src/lib/bot-client", () => {
    class BotUnavailableError extends Error {
      constructor(public detail: string) { super(detail); }
    }
    class WriteRefusedError extends BotUnavailableError {
      constructor(detail: string, public problems: string[]) { super(detail); }
    }
    return {
      getGroups, getOverview, updateGroup, deleteGroup: vi.fn(),
      getCapabilities: async () => (await getOverview()).writes,
      getCampaignState: async (id: string) => (await getOverview()).campaigns.find((row: { slug: string }) => row.slug === id) ?? null,
      BotUnavailableError, WriteRefusedError,
      WritesDisabledError: class extends Error { detail = "writes off"; },
    };
  });
  getGroups.mockResolvedValue({ groups: [group()] });
  getOverview.mockResolvedValue({ writes: capabilities, campaigns: [{ slug, enabled: true }] });
  updateGroup.mockResolvedValue({});
  return (await import("@/app/groups/actions")).addGroupCampaignAction;
}

afterEach(() => {
  vi.resetModules();
  for (const name of ["@/src/config", "next/cache", "@/src/lib/bot-client"]) vi.doUnmock(name);
});

describe("addGroupCampaignAction", () => {
  it("refuses read-only requests without contacting the bot", async () => {
    const add = await loadAction(false);
    expect(await add(jid, slug)).toEqual({ ok: false, detail: "The console is in read-only mode." });
    expect(getGroups).not.toHaveBeenCalled();
    expect(getOverview).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it.each([
    ["../settings", slug], [null, slug], [jid, "../settings"], [jid, ""], [jid, null],
  ])("rejects malformed identifiers (%s, %s)", async (badJid, badSlug) => {
    const add = await loadAction();
    expect((await add(badJid as string, badSlug as string)).ok).toBe(false);
    expect(getGroups).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { ...capabilities, enabled: false },
    { ...capabilities, fields: { groups: ["note"] } },
  ])("checks the bot's current write capability", async (writes) => {
    const add = await loadAction();
    getOverview.mockResolvedValue({ writes, campaigns: [{ slug }] });
    expect((await add(jid, slug)).ok).toBe(false);
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("rejects a missing campaign", async () => {
    const add = await loadAction();
    getOverview.mockResolvedValue({ writes: capabilities, campaigns: [] });
    expect(await add(jid, slug)).toEqual({ ok: false, detail: "This campaign is no longer on record." });
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("rejects a missing group", async () => {
    const add = await loadAction();
    getGroups.mockResolvedValue({ groups: [] });
    expect(await add(jid, slug)).toEqual({ ok: false, detail: "This group is no longer on record." });
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it.each(["on-hold", "admin-only", "not-a-member"] as const)("rejects an %s group", async (status) => {
    const add = await loadAction();
    getGroups.mockResolvedValue({ groups: [group({ status })] });
    expect(await add(jid, slug)).toEqual({ ok: false, detail: `This group is ${status}, so it cannot be added to a campaign.` });
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("appends to fresh membership without touching pauses, cadence, or other fields", async () => {
    const add = await loadAction();
    getGroups.mockResolvedValue({ groups: [group({ promos: ["borehole-drilling", "cv"] })] });
    expect(await add(jid, slug)).toEqual({ ok: true });
    expect(updateGroup.mock.calls).toEqual([
      [jid, { promos: ["borehole-drilling", "cv", slug] }, { by: "Joseph", dryRun: true }],
      [jid, { promos: ["borehole-drilling", "cv", slug] }, { by: "Joseph" }],
    ]);
    expect(revalidate.mock.calls).toEqual([["/groups"], ["/"], [`/campaigns/${slug}`], ["/campaigns"]]);
  });

  it("accepts switched-off campaigns without enabling them", async () => {
    const add = await loadAction();
    getOverview.mockResolvedValue({ writes: capabilities, campaigns: [{ slug, enabled: false }] });
    expect(await add(jid, slug)).toEqual({ ok: true });
    expect(updateGroup).toHaveBeenLastCalledWith(jid, { promos: ["borehole-drilling", slug] }, { by: "Joseph" });
  });

  it("refreshes an existing assignment without writing or resuming it", async () => {
    const add = await loadAction();
    getGroups.mockResolvedValue({ groups: [group({ promos: [slug], pausedPromos: [slug], weekly: { [slug]: ["mon"] } })] });
    expect(await add(jid, slug)).toEqual({ ok: true });
    expect(updateGroup).not.toHaveBeenCalled();
    expect(revalidate).toHaveBeenCalledWith("/groups");
    expect(revalidate).toHaveBeenCalledWith(`/campaigns/${slug}`);
  });

  it("does not commit when the dry run is refused, and returns the bot's explanation", async () => {
    const add = await loadAction();
    const { WriteRefusedError } = await import("@/src/lib/bot-client");
    updateGroup.mockRejectedValue(new WriteRefusedError("The bot refused the change.", ["membership is invalid"], 400));
    expect(await add(jid, slug)).toEqual({ ok: false, detail: "The bot refused the change.", problems: ["membership is invalid"] });
    expect(updateGroup).toHaveBeenCalledTimes(1);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("reports an unavailable bot and an uncertain commit as failures", async () => {
    const add = await loadAction();
    const { BotUnavailableError } = await import("@/src/lib/bot-client");
    getGroups.mockRejectedValueOnce(new BotUnavailableError("The bot is unavailable."));
    expect(await add(jid, slug)).toEqual({ ok: false, detail: "The bot is unavailable." });
    expect(updateGroup).not.toHaveBeenCalled();
    updateGroup.mockResolvedValueOnce({}).mockRejectedValueOnce(new BotUnavailableError("The change may still have been made."));
    expect(await add(jid, slug)).toEqual({ ok: false, detail: "The change may still have been made." });
    expect(revalidate).not.toHaveBeenCalled();
  });
});
