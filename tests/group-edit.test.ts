import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changedGroupFields,
  groupEditProblems,
  newGroupFromDiscovered,
} from "@/src/domains/group-edit";
import type { DiscoveredGroup, Group } from "@/src/lib/types";

function group(overrides: Partial<Group> = {}): Group {
  return {
    jid: "120363111@g.us", name: "Harare Market", source: "operator", status: "active",
    activity: "normal", account: "default", dailyCapOverride: null, promos: ["genaie"],
    weekly: {}, note: null, cap: 4, replyScore: null, allowedToday: ["genaie"],
    ...overrides,
  };
}

const WORDS = { lines: ["default", "ads"], tiers: ["busy", "normal", "quiet"] };

describe("changedGroupFields", () => {
  it("keeps only what actually changes", () => {
    expect(changedGroupFields(group(), { name: "Harare Market", status: "on-hold" }))
      .toEqual({ status: "on-hold" });
  });

  it("reads blank text as none, the way the bot stores it", () => {
    expect(changedGroupFields(group({ note: "old" }), { note: "   " })).toEqual({ note: null });
    expect(changedGroupFields(group(), { note: "" })).toEqual({});
  });

  it("turns the cap field's text into a number, and blank into 'use the band'", () => {
    expect(changedGroupFields(group(), { daily_cap: "3" })).toEqual({ daily_cap: 3 });
    expect(changedGroupFields(group({ dailyCapOverride: 3 }), { daily_cap: "" }))
      .toEqual({ daily_cap: null });
  });

  it("ignores a field the form did not include", () => {
    expect(changedGroupFields(group(), {})).toEqual({});
  });
});

describe("groupEditProblems", () => {
  it("passes a sound change", () => {
    expect(groupEditProblems({ status: "on-hold", daily_cap: 2, account: "ads" }, WORDS)).toEqual([]);
  });

  it.each([
    [{ status: "paused" }, /Status/],
    [{ activity: "frantic" }, /Tier/],
    [{ account: "sales" }, /Line/],
    [{ daily_cap: -1 }, /Daily cap/],
    [{ daily_cap: 2.5 }, /Daily cap/],
    [{ daily_cap: Number.NaN }, /Daily cap/],
    [{ note: "x".repeat(501) }, /500/],
    [{ promos: [] } as never, /not something this dialog edits/],
  ])("names what is wrong with %j", (edit, pattern) => {
    expect(groupEditProblems(edit, WORDS).join(" ")).toMatch(pattern);
  });
});

describe("newGroupFromDiscovered", () => {
  function found(accounts: string[], name: string | null = "New Group"): DiscoveredGroup {
    return { jid: "1@g.us", name, firstSeenAt: "", lastSeenAt: "",
             accounts: accounts.map((accountId) => ({ accountId, firstSeenAt: "", lastSeenAt: "" })) };
  }

  it("starts active and in no campaign, so adding never starts sending", () => {
    expect(newGroupFromDiscovered(found(["default"]))).toEqual({
      name: "New Group", source: "whatsapp", status: "active", promos: [], daily_cap: null,
    });
  });

  it("goes on the line that saw it when the default line did not", () => {
    expect(newGroupFromDiscovered(found(["ads"]))).toMatchObject({ account: "ads" });
    expect(newGroupFromDiscovered(found(["ads", "default"]))).not.toHaveProperty("account");
  });

  it("keeps a missing name as none", () => {
    expect(newGroupFromDiscovered(found(["default"], "  ")).name).toBeNull();
  });
});

/* -------------------------------------------------------------- actions -- */

const updateGroup = vi.fn();
const getGroups = vi.fn();
const getOverview = vi.fn();
const revalidate = vi.fn();

async function loadActions(writes = true) {
  vi.resetModules();
  for (const fn of [updateGroup, getGroups, getOverview, revalidate]) fn.mockReset();
  getGroups.mockResolvedValue({ groups: [group()], discoveredGroups: [] });
  getOverview.mockResolvedValue({
    accounts: [{ id: "default" }, { id: "ads" }],
    capSettings: { enabled: true, defaultActivity: "normal",
                   bands: { busy: [6, 10], normal: [4, 6], quiet: [1, 3] } },
  });
  vi.doMock("@/src/config", () => ({ WRITES_ENABLED: writes, OPERATOR_NAME: "Joseph" }));
  vi.doMock("next/cache", () => ({ revalidatePath: revalidate }));
  vi.doMock("@/src/lib/bot-client", () => {
    class BotUnavailableError extends Error {
      detail: string;
      constructor(detail: string) { super(detail); this.detail = detail; }
    }
    class WriteRefusedError extends BotUnavailableError {
      problems: string[];
      constructor(detail: string, problems: string[]) { super(detail); this.problems = problems; }
    }
    return {
      updateGroup, getGroups, getOverview, deleteGroup: vi.fn(),
      BotUnavailableError, WriteRefusedError,
      WritesDisabledError: class extends Error { detail = "writes off"; },
    };
  });
  return import("@/app/groups/actions");
}

afterEach(() => {
  vi.resetModules();
  for (const name of ["@/src/config", "next/cache", "@/src/lib/bot-client"]) vi.doUnmock(name);
});

describe("updateGroupAction", () => {
  const JID = "120363111@g.us";

  it("is guarded while writes are off", async () => {
    const { updateGroupAction } = await loadActions(false);
    expect(await updateGroupAction(JID, { status: "on-hold" }, { status: "active" }))
      .toEqual({ ok: false, detail: "The console is in read-only mode." });
    expect(getGroups).not.toHaveBeenCalled();
  });

  it("refuses something that is not a group", async () => {
    const { updateGroupAction } = await loadActions();
    expect((await updateGroupAction("../settings", {}, {})).ok).toBe(false);
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("sends only what changed, attributed, and refreshes the screens", async () => {
    const { updateGroupAction } = await loadActions();
    updateGroup.mockResolvedValue({});
    expect(await updateGroupAction(JID, { status: "on-hold", daily_cap: "2" },
                                   { status: "active", daily_cap: null })).toEqual({ ok: true });
    expect(updateGroup).toHaveBeenCalledWith(JID, { status: "on-hold", daily_cap: 2 }, { by: "Joseph" });
    expect(revalidate.mock.calls).toEqual([["/groups"], ["/"]]);
  });

  it("does nothing, successfully, when nothing changed", async () => {
    const { updateGroupAction } = await loadActions();
    expect(await updateGroupAction(JID, { status: "active" }, { status: "active" })).toEqual({ ok: true });
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("refuses a change made over a newer value", async () => {
    // The dialog opened on status "active"; someone has since put it on hold.
    const { updateGroupAction } = await loadActions();
    getGroups.mockResolvedValue({ groups: [group({ status: "on-hold" })] });
    const outcome = await updateGroupAction(JID, { status: "admin-only" }, { status: "active" });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok || outcome.detail).toMatch(/changed since you started editing/);
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("is not blocked by a newer value in a field it is not changing", async () => {
    const { updateGroupAction } = await loadActions();
    getGroups.mockResolvedValue({ groups: [group({ note: "someone else's note" })] });
    updateGroup.mockResolvedValue({});
    expect(await updateGroupAction(JID, { status: "on-hold" }, { status: "active" })).toEqual({ ok: true });
  });

  it("names what is wrong before reaching the bot", async () => {
    const { updateGroupAction } = await loadActions();
    const outcome = await updateGroupAction(JID, { account: "sales" }, { account: "default" });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? [] : outcome.problems).toEqual(["Line must be one of default, ads."]);
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("hands back the bot's reasons when it refuses", async () => {
    const { updateGroupAction } = await loadActions();
    const { WriteRefusedError } = await import("@/src/lib/bot-client");
    updateGroup.mockRejectedValue(new (WriteRefusedError as unknown as new (
      d: string, p: string[]) => Error)("this change would stop it being advertised to", ["why"]));
    expect(await updateGroupAction(JID, { status: "on-hold" }, { status: "active" })).toEqual({
      ok: false, detail: "this change would stop it being advertised to", problems: ["why"],
    });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("says so when the group has gone", async () => {
    const { updateGroupAction } = await loadActions();
    getGroups.mockResolvedValue({ groups: [] });
    const outcome = await updateGroupAction(JID, { status: "on-hold" }, { status: "active" });
    expect(outcome.ok || outcome.detail).toMatch(/no longer on record/);
  });
});

describe("addDiscoveredGroupAction", () => {
  const FOUND: DiscoveredGroup = {
    jid: "120363999@g.us", name: "Fresh Group", firstSeenAt: "", lastSeenAt: "",
    accounts: [{ accountId: "ads", firstSeenAt: "", lastSeenAt: "" }],
  };

  it("adds a group the bot discovered, active and in no campaign", async () => {
    const { addDiscoveredGroupAction } = await loadActions();
    getGroups.mockResolvedValue({ groups: [group()], discoveredGroups: [FOUND] });
    updateGroup.mockResolvedValue({});
    expect(await addDiscoveredGroupAction(FOUND.jid)).toEqual({ ok: true });
    expect(updateGroup).toHaveBeenCalledWith(FOUND.jid, {
      name: "Fresh Group", source: "whatsapp", status: "active", promos: [],
      daily_cap: null, account: "ads",
    }, { by: "Joseph" });
  });

  it("only adds a group the bot itself lists as discovered", async () => {
    // The jid comes from the browser; the record never does.
    const { addDiscoveredGroupAction } = await loadActions();
    expect((await addDiscoveredGroupAction("120363999@g.us")).ok).toBe(false);
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("does not re-add a group already on record", async () => {
    const { addDiscoveredGroupAction } = await loadActions();
    getGroups.mockResolvedValue({ groups: [group({ jid: FOUND.jid })], discoveredGroups: [FOUND] });
    const outcome = await addDiscoveredGroupAction(FOUND.jid);
    expect(outcome.ok || outcome.detail).toMatch(/already on record/);
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("is guarded while writes are off", async () => {
    const { addDiscoveredGroupAction } = await loadActions(false);
    expect((await addDiscoveredGroupAction(FOUND.jid)).ok).toBe(false);
    expect(getGroups).not.toHaveBeenCalled();
  });
});
