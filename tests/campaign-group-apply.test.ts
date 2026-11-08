import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyGroupDraft, isPausedInDraft, parseGroupDraft, planAssignmentWrites, reconcileGroupDraft,
  togglePause, withoutJids, type CampaignGroupDraft, type CampaignGroupRow,
} from "@/src/lib/campaign-group-draft";
import type { Group } from "@/src/lib/types";

const SLUG = "borehole";

function group(jid: string, overrides: Partial<Group> = {}): Group {
  return {
    jid, name: jid, source: "operator", status: "active", activity: "normal",
    account: "default", dailyCapOverride: null, promos: [], weekly: {}, note: null,
    cap: 4, replyScore: null, allowedToday: [], ...overrides,
  };
}

function row(jid: string, paused = false): CampaignGroupRow {
  return { jid, name: jid, account: "default", contactNumber: null, ref: null, variant: 0,
           sendsToday: !paused, allowedToday: [], weekly: [], ...(paused ? { paused } : {}) } as CampaignGroupRow;
}

function draft(parts: Partial<CampaignGroupDraft>): CampaignGroupDraft {
  return { ...emptyGroupDraft(), ...parts };
}

describe("drafts that resume a live pause", () => {
  it("leave a draft without resumes exactly as it was stored", () => {
    const raw = '{"version":1,"added":[],"removed":[],"paused":["1@g.us"]}';
    expect(JSON.stringify(parseGroupDraft(raw))).toBe(raw);
  });

  it("read and keep resumes", () => {
    expect(parseGroupDraft('{"version":1,"added":[],"removed":[],"paused":[],"resumed":["1@g.us"]}').resumed)
      .toEqual(["1@g.us"]);
    expect(() => parseGroupDraft('{"version":1,"added":[],"removed":[],"paused":[],"resumed":[3]}')).toThrow();
  });

  it("stage a resume for a group the bot has paused, and undo it with a second click", () => {
    const live = row("1@g.us", true);
    expect(isPausedInDraft(emptyGroupDraft(), live.jid, live)).toBe(true);
    const resumed = togglePause(emptyGroupDraft(), live.jid, live);
    expect(resumed).toEqual(draft({ resumed: ["1@g.us"] }));
    expect(isPausedInDraft(resumed, live.jid, live)).toBe(false);
    expect(togglePause(resumed, live.jid, live)).toEqual(emptyGroupDraft());
  });

  it("stage a pause for a running group, and undo it with a second click", () => {
    const live = row("1@g.us");
    const paused = togglePause(emptyGroupDraft(), live.jid, live);
    expect(paused).toEqual(draft({ paused: ["1@g.us"] }));
    expect(togglePause(paused, live.jid, live)).toEqual(emptyGroupDraft());
  });

  it("absorb a pause or resume the bot already shows", () => {
    const known = [{ jid: "1@g.us", name: "a", account: "default", status: "active" as const },
                   { jid: "2@g.us", name: "b", account: "default", status: "active" as const }];
    const staged = draft({ paused: ["1@g.us"], resumed: ["2@g.us"] });
    // Both applied: 1 is now paused on the bot, 2 is now running.
    expect(reconcileGroupDraft(staged, [row("1@g.us", true), row("2@g.us")], known).draft)
      .toEqual(emptyGroupDraft());
    // Neither applied yet: both stay staged, and the draft object is unchanged.
    const live = [row("1@g.us"), row("2@g.us", true)];
    expect(reconcileGroupDraft(staged, live, known).draft).toBe(staged);
  });

  it("take out only the groups that were applied", () => {
    const staged = draft({ added: ["1@g.us"], removed: ["2@g.us"], resumed: ["3@g.us"] });
    expect(withoutJids(staged, ["1@g.us", "3@g.us"])).toEqual(draft({ removed: ["2@g.us"] }));
  });
});

describe("planAssignmentWrites", () => {
  it("clears a removed campaign from promos, pauses and cadence in one write", () => {
    const groups = [group("1@g.us", {
      promos: ["cv", SLUG], pausedPromos: [SLUG], weekly: { [SLUG]: ["mon"], cv: ["tue"] },
    })];
    expect(planAssignmentWrites(SLUG, draft({ removed: ["1@g.us"] }), groups).writes).toEqual([{
      jid: "1@g.us",
      fields: { promos: ["cv"], paused_promos: [], weekly: { cv: ["tue"] } },
    }]);
  });

  it("only sends what a removal changes", () => {
    const groups = [group("1@g.us", { promos: [SLUG, "cv"] })];
    expect(planAssignmentWrites(SLUG, draft({ removed: ["1@g.us"] }), groups).writes)
      .toEqual([{ jid: "1@g.us", fields: { promos: ["cv"] } }]);
  });

  it("builds on the group as it is now, not as the page showed it", () => {
    // Since the page loaded, someone else added this group to cv.
    const groups = [group("1@g.us", { promos: ["cv"] })];
    expect(planAssignmentWrites(SLUG, draft({ added: ["1@g.us"] }), groups).writes)
      .toEqual([{ jid: "1@g.us", fields: { promos: ["cv", SLUG] } }]);
  });

  it("adds and pauses a group in one write", () => {
    const groups = [group("1@g.us")];
    expect(planAssignmentWrites(SLUG, draft({ added: ["1@g.us"], paused: ["1@g.us"] }), groups).writes)
      .toEqual([{ jid: "1@g.us", fields: { promos: [SLUG], paused_promos: [SLUG] } }]);
  });

  it("resumes only this campaign", () => {
    const groups = [group("1@g.us", { promos: [SLUG, "cv"], pausedPromos: ["cv", SLUG] })];
    expect(planAssignmentWrites(SLUG, draft({ resumed: ["1@g.us"] }), groups).writes)
      .toEqual([{ jid: "1@g.us", fields: { paused_promos: ["cv"] } }]);
  });

  it("sends nothing for a change the bot already has", () => {
    const groups = [group("1@g.us", { promos: [SLUG] }), group("2@g.us", { promos: [SLUG], pausedPromos: [SLUG] })];
    const plan = planAssignmentWrites(SLUG, draft({ added: ["1@g.us"], paused: ["2@g.us"] }), groups);
    expect(plan.writes).toEqual([]);
    expect(plan.absorbed).toEqual(["1@g.us", "2@g.us"]);
  });

  it("names groups it cannot apply to", () => {
    const groups = [group("1@g.us", { status: "on-hold" }), group("2@g.us")];
    const plan = planAssignmentWrites(SLUG, draft({ added: ["1@g.us"], paused: ["2@g.us", "9@g.us"] }), groups);
    expect(plan.failures.map((entry) => entry.jid)).toEqual(["1@g.us", "2@g.us", "9@g.us"]);
    expect(plan.failures[0].detail).toMatch(/on-hold/);
    expect(plan.failures[1].detail).toMatch(/no longer in the campaign/);
    expect(plan.failures[2].detail).toMatch(/no longer on record/);
  });
});

/* -------------------------------------------------------------- actions -- */

const updateGroup = vi.fn();
const updateCampaign = vi.fn();
const getGroups = vi.fn();
const getCampaigns = vi.fn();
const revalidate = vi.fn();

async function loadActions(writes = true) {
  vi.resetModules();
  for (const fn of [updateGroup, updateCampaign, getGroups, getCampaigns, revalidate]) fn.mockReset();
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
      updateGroup, updateCampaign, getGroups, getCampaigns,
      getCampaignPreview: vi.fn(), updateCampaignCaptions: vi.fn(),
      BotUnavailableError, WriteRefusedError,
      WritesDisabledError: class extends Error { detail = "writes off"; },
    };
  });
  const actions = await import("@/app/campaigns/actions");
  const client = await import("@/src/lib/bot-client");
  return {
    ...actions,
    refused: (detail: string, problems: string[]) =>
      new (client.WriteRefusedError as unknown as new (d: string, p: string[]) => Error)(detail, problems),
    unavailable: (detail: string) =>
      new (client.BotUnavailableError as unknown as new (d: string) => Error)(detail),
  };
}

afterEach(() => {
  vi.resetModules();
  for (const name of ["@/src/config", "next/cache", "@/src/lib/bot-client"]) vi.doUnmock(name);
});

/** Each write as [jid, fields, dryRun]. */
function writes() {
  return updateGroup.mock.calls.map(([jid, fields, options]) => [jid, fields, Boolean(options.dryRun)]);
}

describe("applyCampaignGroupsAction", () => {
  const STAGED = draft({ added: ["1@g.us"], removed: ["2@g.us"] });
  const GROUPS = [group("1@g.us"), group("2@g.us", { promos: [SLUG] })];

  it("is guarded while writes are off", async () => {
    const { applyCampaignGroupsAction } = await loadActions(false);
    expect(await applyCampaignGroupsAction(SLUG, STAGED))
      .toEqual({ ok: false, done: [], detail: "The console is in read-only mode." });
    expect(getGroups).not.toHaveBeenCalled();
  });

  it.each([
    ["../settings", STAGED],
    [SLUG, { version: 2 } as never],
    [SLUG, draft({ added: ["../settings"] })],
  ])("refuses a bad request (%s)", async (slug, staged) => {
    const { applyCampaignGroupsAction } = await loadActions();
    expect((await applyCampaignGroupsAction(slug, staged)).ok).toBe(false);
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("dry-runs every change, then makes them, attributed", async () => {
    const { applyCampaignGroupsAction } = await loadActions();
    getGroups.mockResolvedValue({ groups: GROUPS });
    updateGroup.mockResolvedValue({});
    expect(await applyCampaignGroupsAction(SLUG, STAGED)).toEqual({ ok: true, done: ["1@g.us", "2@g.us"] });
    expect(writes()).toEqual([
      ["1@g.us", { promos: [SLUG] }, true],
      ["2@g.us", { promos: [] }, true],
      ["1@g.us", { promos: [SLUG] }, false],
      ["2@g.us", { promos: [] }, false],
    ]);
    expect(updateGroup.mock.calls[2][2]).toEqual({ by: "Joseph" });
    expect(revalidate).toHaveBeenCalledWith(`/campaigns/${SLUG}`);
  });

  it("makes no change at all when the bot would refuse any one", async () => {
    const { applyCampaignGroupsAction, refused } = await loadActions();
    getGroups.mockResolvedValue({ groups: GROUPS });
    updateGroup.mockImplementation(async (jid: string) => {
      if (jid === "2@g.us") throw refused("this change would stop it being advertised to", ["why"]);
      return {};
    });
    const outcome = await applyCampaignGroupsAction(SLUG, STAGED);
    expect(outcome).toEqual({
      ok: false, done: [],
      detail: "The bot would refuse part of this draft, so nothing was changed.",
      failures: [{ jid: "2@g.us", detail: "this change would stop it being advertised to", problems: ["why"] }],
    });
    expect(writes().every(([, , dryRun]) => dryRun)).toBe(true);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("names a group it cannot apply to, and sends nothing", async () => {
    const { applyCampaignGroupsAction } = await loadActions();
    getGroups.mockResolvedValue({ groups: [GROUPS[1]] });
    const outcome = await applyCampaignGroupsAction(SLUG, STAGED);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok || outcome.failures?.[0]).toMatchObject({ jid: "1@g.us" });
    expect(updateGroup).not.toHaveBeenCalled();
  });

  it("stops at the first failed write and reports what was already made", async () => {
    const { applyCampaignGroupsAction, unavailable } = await loadActions();
    getGroups.mockResolvedValue({ groups: GROUPS });
    updateGroup.mockImplementation(async (jid: string, _fields: unknown, options: { dryRun?: boolean }) => {
      if (jid === "2@g.us" && !options.dryRun) throw unavailable("The bot did not answer in time. The change may still have been made.");
      return {};
    });
    const outcome = await applyCampaignGroupsAction(SLUG, STAGED);
    expect(outcome.ok).toBe(false);
    expect(outcome.done).toEqual(["1@g.us"]);
    expect(outcome.ok || outcome.detail).toMatch(/Stopped after 1 of 2 groups.*may still have been made/);
    expect(outcome.ok || outcome.failures).toEqual([
      { jid: "2@g.us", detail: "The bot did not answer in time. The change may still have been made." },
    ]);
    // The first group did change, so the screens are refreshed anyway.
    expect(revalidate).toHaveBeenCalled();
  });

  it("counts a change the bot already has as done, without writing it", async () => {
    const { applyCampaignGroupsAction } = await loadActions();
    getGroups.mockResolvedValue({ groups: [group("1@g.us", { promos: [SLUG] })] });
    expect(await applyCampaignGroupsAction(SLUG, draft({ added: ["1@g.us"] })))
      .toEqual({ ok: true, done: ["1@g.us"] });
    expect(updateGroup).not.toHaveBeenCalled();
  });
});

describe("setCampaignEnabledAction", () => {
  function campaign(storeEnabled: boolean) {
    return { slug: SLUG, enabled: storeEnabled, storeEnabled, cronEnabled: true };
  }

  it("is guarded while writes are off", async () => {
    const { setCampaignEnabledAction } = await loadActions(false);
    expect((await setCampaignEnabledAction(SLUG, false)).ok).toBe(false);
    expect(getCampaigns).not.toHaveBeenCalled();
  });

  it("switches the operator's switch, attributed", async () => {
    const { setCampaignEnabledAction } = await loadActions();
    getCampaigns.mockResolvedValue([campaign(true)]);
    updateCampaign.mockResolvedValue({});
    expect(await setCampaignEnabledAction(SLUG, false)).toEqual({ ok: true });
    expect(updateCampaign).toHaveBeenCalledWith(SLUG, { enabled: false }, { by: "Joseph" });
    expect(revalidate).toHaveBeenCalledWith("/campaigns");
  });

  it("writes nothing when the switch is already where it was asked to go", async () => {
    // Another tab turned it off first.
    const { setCampaignEnabledAction } = await loadActions();
    getCampaigns.mockResolvedValue([campaign(false)]);
    expect(await setCampaignEnabledAction(SLUG, false)).toEqual({ ok: true });
    expect(updateCampaign).not.toHaveBeenCalled();
  });

  it("reads the operator's switch, not the combined one", async () => {
    // Off only because no cron is registered: turning the switch off still writes.
    const { setCampaignEnabledAction } = await loadActions();
    getCampaigns.mockResolvedValue([{ slug: SLUG, enabled: false, storeEnabled: true, cronEnabled: false }]);
    updateCampaign.mockResolvedValue({});
    await setCampaignEnabledAction(SLUG, false);
    expect(updateCampaign).toHaveBeenCalled();
  });

  it("hands back the bot's reasons when it refuses", async () => {
    const { setCampaignEnabledAction, refused } = await loadActions();
    getCampaigns.mockResolvedValue([campaign(true)]);
    updateCampaign.mockRejectedValue(refused("no", ["campaigns/borehole: enabled must be true or false"]));
    expect(await setCampaignEnabledAction(SLUG, false)).toEqual({
      ok: false, detail: "no", problems: ["campaigns/borehole: enabled must be true or false"],
    });
  });

  it("says so when the campaign has gone", async () => {
    const { setCampaignEnabledAction } = await loadActions();
    getCampaigns.mockResolvedValue([]);
    expect((await setCampaignEnabledAction(SLUG, false)).ok).toBe(false);
    expect(updateCampaign).not.toHaveBeenCalled();
  });
});
