import { afterEach, describe, expect, it, vi } from "vitest";
import type { Group, WriteCapabilities } from "@/src/lib/types";

const getGroups = vi.fn();
const getOverview = vi.fn();
const updateGroup = vi.fn();
const updateGroupBatch = vi.fn();
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

async function loadActions(writes = true) {
  vi.resetModules();
  updateGroupBatch.mockReset().mockResolvedValue(null);
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
      getGroups, getOverview, updateGroup, updateGroupBatch, deleteGroup: vi.fn(),
      getCapabilities: async () => (await getOverview()).writes,
      getCampaignState: async (id: string) => (await getOverview()).campaigns.find((row: { slug: string }) => row.slug === id) ?? null,
      BotUnavailableError, WriteRefusedError,
      WritesDisabledError: class extends Error { detail = "writes off"; },
    };
  });
  getGroups.mockResolvedValue({ groups: [group()] });
  getOverview.mockResolvedValue({ writes: capabilities, campaigns: [{ slug, enabled: true }] });
  updateGroup.mockResolvedValue({});
  return import("@/app/groups/actions");
}

async function loadAction(writes = true) {
  return (await loadActions(writes)).addGroupCampaignAction;
}

afterEach(() => {
  vi.resetModules();
  for (const name of ["@/src/config", "next/cache", "@/src/lib/bot-client"]) vi.doUnmock(name);
});

describe("addGroupCampaignsAction", () => {
  const secondJid = "120363222@g.us";
  const secondSlug = "web-design";
  const context = { writes: capabilities, campaigns: [{ slug }, { slug: secondSlug }] };

  it("appends missing memberships across groups with one transaction and deduplicates the inputs", async () => {
    const { addGroupCampaignsAction: add } = await loadActions();
    getGroups.mockResolvedValue({ groups: [group({ promos: [slug] }), group({ jid: secondJid, promos: [secondSlug] })], context });
    updateGroupBatch.mockResolvedValue({ done: [jid, secondJid], changed: 2 });

    expect(await add([jid, secondJid, jid], [slug, secondSlug, slug])).toEqual({ ok: true });
    expect(getGroups).toHaveBeenCalledExactlyOnceWith(undefined, { fresh: true, jids: [jid, secondJid] });
    expect(updateGroupBatch).toHaveBeenCalledExactlyOnceWith([
      { id: jid, fields: { promos: [slug, secondSlug] }, expected: { promos: [slug] } },
      { id: secondJid, fields: { promos: [secondSlug, slug] }, expected: { promos: [secondSlug] } },
    ], { by: "Joseph" });
    expect(updateGroup).not.toHaveBeenCalled();
    expect(revalidate.mock.calls).toEqual([["/groups"], ["/"], [`/campaigns/${slug}`], [`/campaigns/${secondSlug}`], ["/campaigns"]]);
  });

  it("rejects oversized and read-only batches before reading the bot", async () => {
    const { addGroupCampaignsAction: add } = await loadActions();
    expect(await add(Array.from({ length: 101 }, (_, index) => `${index}@g.us`), [slug])).toMatchObject({ ok: false, detail: expect.stringContaining("100") });
    expect(getGroups).not.toHaveBeenCalled();
    const { addGroupCampaignsAction: readOnlyAdd } = await loadActions(false);
    expect(await readOnlyAdd([jid, secondJid], [slug])).toMatchObject({ ok: false, detail: expect.stringContaining("read-only") });
    expect(getGroups).not.toHaveBeenCalled();
  });

  it("identifies missing campaigns and unavailable groups without writing", async () => {
    const { addGroupCampaignsAction: add } = await loadActions();
    getGroups.mockResolvedValueOnce({ groups: [group()], context })
      .mockResolvedValueOnce({ groups: [group(), group({ jid: secondJid, name: "Paused Market", status: "on-hold", promos: [slug] })], context });
    expect(await add([jid, secondJid], [slug])).toMatchObject({ ok: false, detail: expect.stringContaining(secondJid) });
    expect(await add([jid, secondJid], [slug])).toMatchObject({ ok: false, detail: expect.stringContaining("Paused Market") });
    getGroups.mockResolvedValue({ groups: [group(), group({ jid: secondJid })], context });
    expect(await add([jid, secondJid], [slug, "deleted-campaign"])).toMatchObject({ ok: false, detail: expect.stringContaining("deleted-campaign") });
    expect(updateGroupBatch).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("returns transactional conflicts without falling back to individual writes", async () => {
    const { addGroupCampaignsAction: add } = await loadActions();
    const { WriteRefusedError } = await import("@/src/lib/bot-client");
    getGroups.mockResolvedValue({ groups: [group(), group({ jid: secondJid })], context });
    updateGroupBatch.mockRejectedValue(new WriteRefusedError("Group changed since the draft was checked.", [], 409));
    expect(await add([jid, secondJid], [slug])).toMatchObject({ ok: false, detail: expect.stringContaining("changed") });
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("dry-runs the entire legacy batch before any commit and skips confirmed assignments on retry", async () => {
    const { addGroupCampaignsAction: add } = await loadActions();
    const { BotUnavailableError } = await import("@/src/lib/bot-client");
    const groups = [group({ promos: [] }), group({ jid: secondJid, promos: [] })];
    getGroups.mockResolvedValue({ groups, context });
    updateGroup.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockResolvedValueOnce({})
      .mockRejectedValueOnce(new BotUnavailableError("Connection lost."));
    expect(await add([jid, secondJid], [slug])).toEqual({
      ok: false, refreshLive: true, detail: `Confirmed assignments for 1 of 2 groups. Stopped at ${secondJid}. Connection lost.`,
    });
    expect(updateGroup.mock.calls.map(([id, , options]) => [id, options.dryRun ?? false])).toEqual([
      [jid, true], [secondJid, true], [jid, false], [secondJid, false],
    ]);
    expect(revalidate).toHaveBeenCalledWith("/groups");

    updateGroup.mockClear();
    getGroups.mockResolvedValue({ groups: [group({ promos: [slug] }), groups[1]], context });
    expect(await add([jid, secondJid], [slug])).toEqual({ ok: true });
    expect(updateGroup.mock.calls.map(([id, , options]) => [id, options.dryRun ?? false])).toEqual([
      [secondJid, true], [secondJid, false],
    ]);
  });

  it("commits no legacy changes when the second group's dry run is refused", async () => {
    const { addGroupCampaignsAction: add } = await loadActions();
    const { WriteRefusedError } = await import("@/src/lib/bot-client");
    getGroups.mockResolvedValue({ groups: [group(), group({ jid: secondJid })], context });
    updateGroup.mockResolvedValueOnce({}).mockRejectedValueOnce(new WriteRefusedError("Invalid membership.", [], 400));
    expect(await add([jid, secondJid], [slug])).toMatchObject({ ok: false, detail: "Invalid membership." });
    expect(updateGroup.mock.calls.map(([, , options]) => options.dryRun)).toEqual([true, true]);
    expect(revalidate).not.toHaveBeenCalled();
  });
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

  it("reuses fresh group context instead of rereading campaign and capabilities", async () => {
    const add = await loadAction();
    getGroups.mockResolvedValue({ groups: [group()], context: {
      writes: capabilities, campaigns: [{ slug, enabled: true }],
    } });
    updateGroupBatch.mockResolvedValue({ done: [jid], changed: 1 });
    expect(await add(jid, slug)).toEqual({ ok: true });
    expect(getGroups).toHaveBeenCalledOnce();
    expect(getOverview).not.toHaveBeenCalled();
    expect(updateGroupBatch).toHaveBeenCalledOnce();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("assigns with one transactional commit and no dry-run on a supporting bot", async () => {
    const add = await loadAction();
    updateGroupBatch.mockResolvedValue({ done: [jid], changed: 1 });
    expect(await add(jid, slug)).toEqual({ ok: true });
    expect(updateGroupBatch).toHaveBeenCalledExactlyOnceWith([{
      id: jid, fields: { promos: ["borehole-drilling", slug] }, expected: { promos: ["borehole-drilling"] },
    }], { by: "Joseph" });
    expect(updateGroup).not.toHaveBeenCalled();
    expect(getGroups).toHaveBeenCalledExactlyOnceWith(undefined, { fresh: true, jid });
  });

  it("adds multiple campaigns in one write and refreshes every selected campaign", async () => {
    const add = await loadAction();
    const secondSlug = "web-design";
    getGroups.mockResolvedValue({ groups: [group()], context: {
      writes: capabilities, campaigns: [{ slug }, { slug: secondSlug }, { slug: "borehole-drilling" }],
    } });
    updateGroupBatch.mockResolvedValue({ done: [jid], changed: 1 });

    expect(await add(jid, [slug, secondSlug, slug, "borehole-drilling"])).toEqual({ ok: true });
    expect(updateGroupBatch).toHaveBeenCalledExactlyOnceWith([{
      id: jid,
      fields: { promos: ["borehole-drilling", slug, secondSlug] },
      expected: { promos: ["borehole-drilling"] },
    }], { by: "Joseph" });
    expect(updateGroup).not.toHaveBeenCalled();
    expect(revalidate).toHaveBeenCalledWith(`/campaigns/${slug}`);
    expect(revalidate).toHaveBeenCalledWith(`/campaigns/${secondSlug}`);
  });

  it("refuses the entire selection when a campaign is missing", async () => {
    const add = await loadAction();
    expect(await add(jid, [slug, "missing"])).toEqual({ ok: false, detail: "This campaign is no longer on record." });
    expect(updateGroupBatch).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("never falls back to another write after an uncertain batch failure", async () => {
    const add = await loadAction();
    const { BotUnavailableError } = await import("@/src/lib/bot-client");
    updateGroupBatch.mockRejectedValue(new BotUnavailableError("Connection lost"));
    expect((await add(jid, slug)).ok).toBe(false);
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
