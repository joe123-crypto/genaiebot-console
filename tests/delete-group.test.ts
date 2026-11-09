import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The console has no login. A hidden button is therefore the only thing
 * between a visitor and a delete, and a hidden button is not an absent
 * endpoint: a server action is a reachable POST whether or not anything
 * renders a control for it. These pin the two guards that stand in for the
 * authentication that is not built yet — the switch, and the typed name.
 */

const deleteGroup = vi.fn();
const groupAction = vi.fn();

async function loadAction(writesEnabled: boolean) {
  vi.resetModules();
  deleteGroup.mockReset();
  groupAction.mockReset();
  groupAction.mockResolvedValue({
    jid: "1203@g.us", account: "default",
    leave: { requested: true, ok: true, already: false, error: null },
    cleared: { requested: true, campaigns: {}, checked: 0 },
  });
  vi.doMock("@/src/config", () => ({
    WRITES_ENABLED: writesEnabled,
    OPERATOR_NAME: "Joseph Munemo",
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("@/src/lib/bot-client", () => {
    class BotUnavailableError extends Error {
      detail: string;
      constructor(detail: string) {
        super("unavailable");
        this.detail = detail;
      }
    }
    // The real hierarchy: a refusal is a kind of "could not change it".
    class WriteRefusedError extends BotUnavailableError {
      problems: string[];
      constructor(detail: string, problems: string[]) {
        super(detail);
        this.problems = problems;
      }
    }
    return {
      deleteGroup,
      groupAction,
      BotUnavailableError,
      WriteRefusedError,
      WritesDisabledError: class extends Error {
        detail = "writes are off";
      },
    };
  });
  return import("@/app/groups/actions");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/src/config");
  vi.doUnmock("next/cache");
  vi.doUnmock("@/src/lib/bot-client");
});

describe("deleteGroupAction", () => {
  it("refuses while writes are off, without calling the bridge", async () => {
    const { deleteGroupAction } = await loadAction(false);
    expect(await deleteGroupAction("1203@g.us")).toEqual({
      ok: false,
      detail: "The console is in read-only mode.",
    });
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("names the operator on the change it makes", async () => {
    const { deleteGroupAction } = await loadAction(true);
    deleteGroup.mockResolvedValue({ jid: "1203@g.us" });

    expect(await deleteGroupAction("1203@g.us", "bot was removed")).toEqual({ ok: true });
    expect(deleteGroup).toHaveBeenCalledWith("1203@g.us", {
      by: "Joseph Munemo",
      reason: "bot was removed",
    });
  });

  it("returns a failure instead of throwing, so the table survives it", async () => {
    const { deleteGroupAction } = await loadAction(true);
    const { BotUnavailableError } = await import("@/src/lib/bot-client");
    deleteGroup.mockRejectedValue(new BotUnavailableError("the write service is busy"));

    expect(await deleteGroupAction("1203@g.us")).toEqual({
      ok: false,
      detail: "the write service is busy",
    });
  });

  it("leaves the reason out when none was given, and trims one that was", async () => {
    const { deleteGroupAction } = await loadAction(true);
    deleteGroup.mockResolvedValue({});
    await deleteGroupAction("1203@g.us", "   ");
    expect(deleteGroup).toHaveBeenLastCalledWith("1203@g.us", { by: "Joseph Munemo" });
    await deleteGroupAction("1203@g.us", "  bot was removed  ");
    expect(deleteGroup).toHaveBeenLastCalledWith("1203@g.us",
      { by: "Joseph Munemo", reason: "bot was removed" });
  });

  it("refuses an oversized reason before reaching the bot", async () => {
    const { deleteGroupAction } = await loadAction(true);
    expect((await deleteGroupAction("1203@g.us", "x".repeat(501))).ok).toBe(false);
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("hands back the bot's own reasons when it refuses", async () => {
    const { deleteGroupAction } = await loadAction(true);
    const { WriteRefusedError } = await import("@/src/lib/bot-client");
    deleteGroup.mockRejectedValue(new (WriteRefusedError as unknown as new (
      d: string, p: string[]) => Error)("groups/1203@g.us does not exist", ["no such group"]));
    expect(await deleteGroupAction("1203@g.us")).toEqual({
      ok: false, detail: "groups/1203@g.us does not exist", problems: ["no such group"],
    });
  });

  it("lets an unexpected error through rather than reporting it as a refusal", async () => {
    const { deleteGroupAction } = await loadAction(true);
    deleteGroup.mockRejectedValue(new TypeError("undefined is not a function"));
    await expect(deleteGroupAction("1203@g.us")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("confirmationMatches", () => {
  it("accepts the name as typed, ignoring case and stray spacing", async () => {
    const { confirmationMatches } = await import("@/app/groups/_components/delete-group");
    expect(confirmationMatches("BULAWAYO ADVERTS", "BULAWAYO ADVERTS")).toBe(true);
    expect(confirmationMatches("  bulawayo adverts ", "BULAWAYO ADVERTS")).toBe(true);
  });

  it("refuses a near miss, which is the whole point of asking", async () => {
    const { confirmationMatches } = await import("@/app/groups/_components/delete-group");
    expect(confirmationMatches("BULAWAYO ADVERT", "BULAWAYO ADVERTS")).toBe(false);
    expect(confirmationMatches("", "BULAWAYO ADVERTS")).toBe(false);
    expect(confirmationMatches("Bulawayo Market", "Bulawayo Markets03")).toBe(false);
  });

  it("never matches an empty expected label, so a nameless row cannot be confirmed blank",
    async () => {
      const { confirmationMatches } = await import("@/app/groups/_components/delete-group");
      expect(confirmationMatches("", "")).toBe(false);
    });
});

/**
 * The optional halves of a delete, and the order they happen in.
 *
 * Order is the thing worth pinning. Removing the record is the step the bot can
 * still refuse; leaving the WhatsApp group is the step that cannot be undone
 * without a new invite. Doing the refusable one first means a failed leave
 * costs nothing more than the group reappearing under Unassigned -- which is
 * what a plain delete has always done. The other way round would leave the bot
 * outside a group it was still configured to advertise to.
 */
describe("deleteGroupAction, leaving and clearing", () => {
  it("does nothing beyond the record unless asked", async () => {
    const { deleteGroupAction } = await loadAction(true);
    deleteGroup.mockResolvedValue({});

    expect(await deleteGroupAction("1203@g.us", { reason: "gone" })).toEqual({ ok: true });
    expect(groupAction).not.toHaveBeenCalled();
  });

  it("still accepts a bare reason, so an older caller cannot lose it", async () => {
    const { deleteGroupAction } = await loadAction(true);
    deleteGroup.mockResolvedValue({});

    expect(await deleteGroupAction("1203@g.us", "bot was removed")).toEqual({ ok: true });
    expect(deleteGroup).toHaveBeenCalledWith("1203@g.us",
      { by: "Joseph Munemo", reason: "bot was removed" });
    expect(groupAction).not.toHaveBeenCalled();
  });

  it("removes the record before asking the bot to leave", async () => {
    const { deleteGroupAction } = await loadAction(true);
    const order: string[] = [];
    deleteGroup.mockImplementation(async () => { order.push("delete"); return {}; });
    groupAction.mockImplementation(async () => {
      order.push("act");
      return { jid: "1203@g.us", account: "ads",
               leave: { requested: true, ok: true }, cleared: { requested: false } };
    });

    await deleteGroupAction("1203@g.us", { leave: true, account: "ads" });

    expect(order).toEqual(["delete", "act"]);
  });

  it("names the line to leave from, which the row knew before the record went", async () => {
    const { deleteGroupAction } = await loadAction(true);
    deleteGroup.mockResolvedValue({});

    await deleteGroupAction("1203@g.us", { leave: true, clearRecords: true, account: "ads" });

    expect(groupAction).toHaveBeenCalledWith("1203@g.us", {
      leave: true, clearRecords: true, account: "ads", by: "Joseph Munemo",
    });
  });

  it("never asks the bot to act when the record could not be removed", async () => {
    const { deleteGroupAction } = await loadAction(true);
    const { WriteRefusedError } = await import("@/src/lib/bot-client");
    deleteGroup.mockRejectedValue(new (WriteRefusedError as unknown as new (
      d: string, p: string[]) => Error)("no such group", []));

    const outcome = await deleteGroupAction("1203@g.us", { leave: true });

    expect(outcome.ok).toBe(false);
    // Leaving a group whose delete was refused would strand the bot outside a
    // group it is still configured to advertise to.
    expect(groupAction).not.toHaveBeenCalled();
  });

  it("reports a failed leave as a warning, because the record really is gone", async () => {
    const { deleteGroupAction } = await loadAction(true);
    deleteGroup.mockResolvedValue({});
    groupAction.mockResolvedValue({
      jid: "1203@g.us", account: "default",
      leave: { requested: true, ok: false, already: false, error: "leave_failed" },
      cleared: { requested: false },
    });

    const outcome = await deleteGroupAction("1203@g.us", { leave: true });

    expect(outcome.ok).toBe(true);
    expect(outcome).toHaveProperty("warnings");
    expect((outcome as { warnings: string[] }).warnings[0]).toMatch(/still in it/);
  });

  it("calls an unconfirmed leave unconfirmed rather than failed", async () => {
    const { deleteGroupAction } = await loadAction(true);
    deleteGroup.mockResolvedValue({});
    groupAction.mockResolvedValue({
      jid: "1203@g.us", account: "default",
      leave: { requested: true, ok: null, already: false, error: "unconfirmed" },
      cleared: { requested: false },
    });

    const outcome = await deleteGroupAction("1203@g.us", { leave: true });

    expect(outcome.ok).toBe(true);
    // Saying "failed" would have the operator try to leave a group the bot may
    // already be out of.
    expect((outcome as { warnings: string[] }).warnings[0]).toMatch(/not confirmed/);
    expect((outcome as { warnings: string[] }).warnings[0]).not.toMatch(/could not/);
  });

  it("says nothing extra when the leave came off", async () => {
    const { deleteGroupAction } = await loadAction(true);
    deleteGroup.mockResolvedValue({});
    groupAction.mockResolvedValue({
      jid: "1203@g.us", account: "default",
      leave: { requested: true, ok: true, already: true, error: null },
      cleared: { requested: true, campaigns: {}, checked: 2 },
    });

    expect(await deleteGroupAction("1203@g.us", { leave: true, clearRecords: true }))
      .toEqual({ ok: true });
  });

  it("keeps the delete a success when the bot could not be reached afterwards", async () => {
    const { deleteGroupAction } = await loadAction(true);
    const { BotUnavailableError } = await import("@/src/lib/bot-client");
    deleteGroup.mockResolvedValue({});
    groupAction.mockRejectedValue(new BotUnavailableError("the gateway is in standby"));

    const outcome = await deleteGroupAction("1203@g.us", { leave: true });

    expect(outcome.ok).toBe(true);
    expect((outcome as { warnings: string[] }).warnings[0])
      .toContain("the gateway is in standby");
  });

  it("refuses everything while writes are off, including the extras", async () => {
    const { deleteGroupAction } = await loadAction(false);
    expect(await deleteGroupAction("1203@g.us", { leave: true, clearRecords: true }))
      .toEqual({ ok: false, detail: "The console is in read-only mode." });
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(groupAction).not.toHaveBeenCalled();
  });

  it("checks the reason before changing anything at all", async () => {
    const { deleteGroupAction } = await loadAction(true);
    expect((await deleteGroupAction("1203@g.us",
      { reason: "x".repeat(501), leave: true })).ok).toBe(false);
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(groupAction).not.toHaveBeenCalled();
  });
});
