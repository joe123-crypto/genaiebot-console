import { afterEach, describe, expect, it, vi } from "vitest";
import type { Group, WriteCapabilities } from "@/src/lib/types";

const getGroups = vi.fn();
const getOverview = vi.fn();
const updateGroup = vi.fn();
const updateGroupBatch = vi.fn();
const revalidate = vi.fn();
const jid = "120363111@g.us";
const slug = "borehole-drilling";

function group(overrides: Partial<Group> = {}): Group {
  return {
    jid, name: "Harare Market", source: "operator", status: "active", activity: "normal",
    account: "default", dailyCapOverride: null, promos: [slug, "fruit-trees"],
    weekly: { [slug]: ["mon"] }, pausedPromos: [slug],
    note: null, cap: 4, replyScore: null, allowedToday: [], ...overrides,
  };
}

/** Removing rewrites three fields, so all three have to be writable. */
const capabilities: WriteCapabilities = {
  enabled: true, affectsProduction: true,
  fields: { groups: ["promos", "paused_promos", "weekly"] }, delete: [],
};

async function loadAction(writes = true) {
  vi.resetModules();
  updateGroupBatch.mockReset().mockResolvedValue({ done: [jid], changed: 1 });
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
      getCampaignState: vi.fn(), getConfiguration: vi.fn(), groupAction: vi.fn(),
      BotUnavailableError, WriteRefusedError,
      WritesDisabledError: class extends Error { detail = "writes off"; },
    };
  });
  getGroups.mockResolvedValue({ groups: [group()] });
  getOverview.mockResolvedValue({ writes: capabilities });
  updateGroup.mockResolvedValue({});
  return (await import("@/app/groups/actions")).removeGroupCampaignAction;
}

afterEach(() => {
  vi.resetModules();
  for (const name of ["@/src/config", "next/cache", "@/src/lib/bot-client"]) vi.doUnmock(name);
});

describe("removeGroupCampaignAction", () => {
  it("refuses read-only requests without contacting the bot", async () => {
    const remove = await loadAction(false);
    expect(await remove(jid, slug)).toEqual({ ok: false, detail: "The console is in read-only mode." });
    expect(getGroups).not.toHaveBeenCalled();
    expect(updateGroupBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["../settings", slug], [null, slug], [jid, "../settings"], [jid, ""], [jid, null],
  ])("rejects malformed identifiers (%s, %s)", async (badJid, badSlug) => {
    const remove = await loadAction();
    expect((await remove(badJid as string, badSlug as string)).ok).toBe(false);
    expect(getGroups).not.toHaveBeenCalled();
    expect(updateGroupBatch).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { ...capabilities, enabled: false },
    // A bot that takes promos but not the pause and cadence the same write
    // has to clear: offering the control here would only fail on save.
    { ...capabilities, fields: { groups: ["promos"] } },
  ])("checks the bot accepts every field the removal touches", async (writes) => {
    const remove = await loadAction();
    getOverview.mockResolvedValue({ writes });
    expect((await remove(jid, slug)).ok).toBe(false);
    expect(updateGroupBatch).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("rejects a missing group", async () => {
    const remove = await loadAction();
    getGroups.mockResolvedValue({ groups: [] });
    expect(await remove(jid, slug)).toEqual({ ok: false, detail: "This group is no longer on record." });
    expect(updateGroupBatch).not.toHaveBeenCalled();
  });

  it("clears the campaign from promos, the pause and the cadence in one write", async () => {
    const remove = await loadAction();
    expect(await remove(jid, slug)).toEqual({ ok: true });
    expect(getGroups).toHaveBeenCalledExactlyOnceWith(undefined, { fresh: true, jid });
    expect(updateGroupBatch).toHaveBeenCalledExactlyOnceWith([{
      id: jid,
      fields: { promos: ["fruit-trees"], paused_promos: [], weekly: {} },
      expected: { promos: [slug, "fruit-trees"], paused_promos: [slug], weekly: { [slug]: ["mon"] } },
    }], { by: "Joseph" });
    expect(updateGroup).not.toHaveBeenCalled();
    expect(revalidate.mock.calls).toEqual([["/groups"], ["/"], [`/campaigns/${slug}`], ["/campaigns"]]);
  });

  it("writes promos alone when the campaign has no pause or cadence there", async () => {
    const remove = await loadAction();
    getGroups.mockResolvedValue({ groups: [group({ weekly: {}, pausedPromos: [] })] });
    expect(await remove(jid, slug)).toEqual({ ok: true });
    expect(updateGroupBatch).toHaveBeenCalledExactlyOnceWith([{
      id: jid, fields: { promos: ["fruit-trees"] }, expected: { promos: [slug, "fruit-trees"] },
    }], { by: "Joseph" });
  });

  it.each(["on-hold", "admin-only", "not-a-member"] as const)("still removes from an %s group", async (status) => {
    const remove = await loadAction();
    getGroups.mockResolvedValue({ groups: [group({ status })] });
    expect(await remove(jid, slug)).toEqual({ ok: true });
    expect(updateGroupBatch).toHaveBeenCalledOnce();
  });

  it("treats a campaign already off the group as done, and refreshes the row", async () => {
    const remove = await loadAction();
    getGroups.mockResolvedValue({ groups: [group({ promos: ["fruit-trees"], weekly: {}, pausedPromos: [] })] });
    expect(await remove(jid, slug)).toEqual({ ok: true });
    expect(updateGroupBatch).not.toHaveBeenCalled();
    expect(updateGroup).not.toHaveBeenCalled();
    expect(revalidate).toHaveBeenCalledWith("/groups");
  });

  it("dry-runs and then writes through an older bot that has no batch route", async () => {
    const remove = await loadAction();
    updateGroupBatch.mockResolvedValue(null);
    expect(await remove(jid, slug)).toEqual({ ok: true });
    const fields = { promos: ["fruit-trees"], paused_promos: [], weekly: {} };
    expect(updateGroup.mock.calls).toEqual([
      [jid, fields, { by: "Joseph", dryRun: true }],
      [jid, fields, { by: "Joseph" }],
    ]);
  });

  it("reports a refusal without touching the campaign pages", async () => {
    const remove = await loadAction();
    const { WriteRefusedError } = await import("@/src/lib/bot-client");
    updateGroupBatch.mockRejectedValue(new WriteRefusedError("This group changed since it was read.", [], 409));
    expect(await remove(jid, slug)).toMatchObject({ ok: false, detail: "This group changed since it was read." });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("reuses the fresh group context instead of rereading capabilities", async () => {
    const remove = await loadAction();
    getGroups.mockResolvedValue({ groups: [group()], context: { writes: capabilities } });
    expect(await remove(jid, slug)).toEqual({ ok: true });
    expect(getOverview).not.toHaveBeenCalled();
  });
});
