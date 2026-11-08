// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capChange, capDraftProblems, describeCapChange, draftFromSettings, storedSettings,
} from "@/src/domains/cap-settings";
import type { CapSettings } from "@/src/lib/types";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/settings/actions", () => ({ saveCapSettingsAction: save }));

import { CapSettingsForm } from "@/app/settings/_components/cap-settings-form";

const SETTINGS: CapSettings = {
  enabled: true, defaultActivity: "normal",
  bands: { busy: [6, 10], normal: [4, 6], quiet: [1, 3] },
};

describe("cap settings", () => {
  it("send nothing for an untouched form", () => {
    expect(capChange(draftFromSettings(SETTINGS), SETTINGS)).toEqual({});
  });

  it("send only what changed, in the bot's field names, with the whole band map", () => {
    const draft = draftFromSettings(SETTINGS);
    draft.enabled = false;
    draft.bands.quiet = ["0", "2"];
    expect(capChange(draft, SETTINGS)).toEqual({
      caps_enabled: false,
      bands: { busy: [6, 10], normal: [4, 6], quiet: [0, 2] },
    });
  });

  it.each([
    [{ quiet: ["", "3"] }, /quiet: enter whole numbers/],
    [{ quiet: ["1.5", "3"] }, /quiet: enter whole numbers/],
    [{ quiet: ["-1", "3"] }, /quiet: enter whole numbers/],
    [{ quiet: ["4", "3"] }, /quiet: the low end cannot be above/],
    [{ busy: ["6", "51"] }, /busy: at most 50/],
  ])("name what is wrong with bands %j", (bands, pattern) => {
    const draft = draftFromSettings(SETTINGS);
    Object.assign(draft.bands, bands);
    expect(capDraftProblems(draft, SETTINGS).join(" ")).toMatch(pattern);
  });

  it("refuse a default tier or a set of tiers the bot does not have", () => {
    const draft = { ...draftFromSettings(SETTINGS), defaultActivity: "frantic" };
    expect(capDraftProblems(draft, SETTINGS).join(" ")).toMatch(/default tier must be one of/);
    const extra = draftFromSettings(SETTINGS);
    extra.bands.frantic = ["1", "2"];
    expect(capDraftProblems(extra, SETTINGS).join(" ")).toMatch(/tiers themselves cannot be changed/);
  });

  it("describe each change in plain words", () => {
    expect(describeCapChange({ caps_enabled: false, activity: "quiet",
                               bands: { busy: [6, 10], normal: [4, 6], quiet: [0, 2] } }, SETTINGS))
      .toEqual([
        "Caps off: every campaign that targets a group posts there every day.",
        "Groups without a tier of their own move from normal to quiet.",
        "quiet: 1–3 becomes 0–2 posts a day.",
      ]);
  });
});

describe("CapSettingsForm", () => {
  afterEach(() => { cleanup(); save.mockReset(); });
  function mount(gate: Parameters<typeof CapSettingsForm>[0]["gate"] = { allowed: true }) {
    return render(createElement(CapSettingsForm, { settings: SETTINGS, gate }));
  }

  it("saves a band after a yes, sending what the form loaded as expected", async () => {
    save.mockResolvedValue({ ok: true });
    mount();
    const saveButton = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("quiet at most"), { target: { value: "2" } });
    fireEvent.click(saveButton);
    const dialog = screen.getByRole("alertdialog", { name: "Save cap settings?" });
    expect(within(dialog).getByText("quiet: 1–3 becomes 1–2 posts a day.")).toBeTruthy();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save" })); });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ bands: expect.objectContaining({ quiet: ["1", "2"] }) }),
      storedSettings(SETTINGS),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText(/Saved\. Changes apply from each campaign's next run/)).toBeTruthy();
  });

  it("does not offer to save a band that cannot be stored", () => {
    mount();
    fireEvent.change(screen.getByLabelText("quiet at least"), { target: { value: "5" } });
    expect(screen.getByRole("alert").textContent).toMatch(/low end cannot be above/);
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the question open on the bot's reasons when it refuses", async () => {
    save.mockResolvedValue({ ok: false, detail: "refused", problems: ["bands.quiet must have 0 <= low <= high"] });
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Cap how many adverts/ }));
    expect(screen.getByText(/With caps off/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(save.mock.calls[0][0]).toMatchObject({ enabled: false });
    expect(within(screen.getByRole("alertdialog")).getByRole("alert").textContent).toMatch(/bands.quiet/);
  });

  it("is read-only, saying why, when the bot will not take the change", () => {
    mount({ allowed: false, reason: "The bot has no write key installed, so it cannot save changes yet." });
    expect((screen.getByLabelText("quiet at most") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByText(/no write key installed/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------- action -- */

describe("saveCapSettingsAction", () => {
  const updateSettings = vi.fn();
  const getOverview = vi.fn();

  async function load(writes = true, current: CapSettings = SETTINGS) {
    vi.resetModules();
    updateSettings.mockReset(); getOverview.mockReset();
    getOverview.mockResolvedValue({ capSettings: current });
    vi.doMock("@/src/config", () => ({ WRITES_ENABLED: writes, OPERATOR_NAME: "Joseph" }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/src/lib/bot-client", () => {
      class BotUnavailableError extends Error {
        detail: string;
        constructor(detail: string) { super(detail); this.detail = detail; }
      }
      return {
        updateSettings, getOverview, BotUnavailableError,
        WriteRefusedError: class extends BotUnavailableError { problems: string[] = []; },
        WritesDisabledError: class extends Error { detail = "writes off"; },
      };
    });
    return (await vi.importActual<typeof import("@/app/settings/actions")>("@/app/settings/actions"))
      .saveCapSettingsAction;
  }

  afterEach(() => {
    for (const name of ["@/src/config", "next/cache", "@/src/lib/bot-client"]) vi.doUnmock(name);
  });

  it("is guarded while writes are off", async () => {
    const action = await load(false);
    expect((await action(draftFromSettings(SETTINGS), storedSettings(SETTINGS))).ok).toBe(false);
    expect(getOverview).not.toHaveBeenCalled();
  });

  it("writes only the changed fields, attributed", async () => {
    const action = await load();
    const draft = { ...draftFromSettings(SETTINGS), defaultActivity: "quiet" };
    expect(await action(draft, storedSettings(SETTINGS))).toEqual({ ok: true });
    expect(updateSettings).toHaveBeenCalledWith({ activity: "quiet" }, { by: "Joseph" });
  });

  it("refuses a change over a newer value in the same field", async () => {
    const action = await load(true, { ...SETTINGS, defaultActivity: "busy" });
    const draft = { ...draftFromSettings(SETTINGS), defaultActivity: "quiet" };
    const outcome = await action(draft, storedSettings(SETTINGS));
    expect(outcome.ok || outcome.detail).toMatch(/changed since this page loaded/);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("is not blocked by a newer value in a field it is not changing", async () => {
    // Someone moved a band since the form loaded; this save only switches caps off.
    const action = await load(true, { ...SETTINGS, bands: { ...SETTINGS.bands, busy: [7, 10] } });
    const draft = { ...draftFromSettings(SETTINGS), enabled: false };
    expect(await action(draft, storedSettings(SETTINGS))).toEqual({ ok: true });
    expect(updateSettings).toHaveBeenCalledWith({ caps_enabled: false }, { by: "Joseph" });
  });

  it("names what is wrong before reaching the bot", async () => {
    const action = await load();
    const draft = draftFromSettings(SETTINGS);
    draft.bands.quiet = ["4", "3"];
    const outcome = await action(draft, storedSettings(SETTINGS));
    expect(outcome.ok ? [] : outcome.problems).toEqual(["quiet: the low end cannot be above the high end."]);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("refuses a malformed request", async () => {
    const action = await load();
    expect((await action({ enabled: "no" } as never, storedSettings(SETTINGS))).ok).toBe(false);
    expect(getOverview).not.toHaveBeenCalled();
  });
});
