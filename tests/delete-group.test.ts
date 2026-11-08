import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The console has no login. A hidden button is therefore the only thing
 * between a visitor and a delete, and a hidden button is not an absent
 * endpoint: a server action is a reachable POST whether or not anything
 * renders a control for it. These pin the two guards that stand in for the
 * authentication that is not built yet — the switch, and the typed name.
 */

const deleteGroup = vi.fn();

async function loadAction(writesEnabled: boolean) {
  vi.resetModules();
  deleteGroup.mockReset();
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
